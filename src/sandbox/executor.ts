import { execa } from "execa"
import fs from "fs-extra"
import path from "path"
import type { AgentConfig } from "../core/config.js"
import type { SandboxArtifact, TestResult } from "../core/failures/types.js"
import { parsePlaywrightReport } from "../core/observability/playwright-parser.js"

const DEFAULT_COMMANDS = {
  install:    "npm install",
  typecheck:  "npm run typecheck",
  test:       "npm test",
  playwright: undefined as string | undefined,
}

const DEFAULT_IMAGE   = "mcr.microsoft.com/playwright/node:lts-jammy"
const DEFAULT_TIMEOUT = 120_000

// ─── Phase execution ──────────────────────────────────────────────────────────

type PhaseResult = {
  phase: SandboxArtifact["metrics"] extends infer M ? string : string
  stdout: string
  stderr: string
  exitCode: number
}

async function runPhase(
  command: string,
  cwd: string,
  timeoutMs: number
): Promise<PhaseResult> {
  const [bin, ...args] = command.split(" ")
  try {
    const result = await execa(bin, args, {
      cwd,
      timeout: timeoutMs,
      reject: false,
      all: true,
    })
    return {
      phase: command,
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? "",
      exitCode: result.exitCode ?? 0,
    }
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; message?: string }
    return {
      phase: command,
      stdout: e.stdout ?? "",
      stderr: e.stderr ?? e.message ?? String(err),
      exitCode: 1,
    }
  }
}

// ─── Docker execution ─────────────────────────────────────────────────────────

async function runInDocker(
  worktreePath: string,
  commands: string[],
  image: string,
  timeoutMs: number
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const script = commands.join(" && ")
  try {
    const result = await execa(
      "docker", [
        "run", "--rm",
        "-v", `${worktreePath}:/workspace`,
        "-w", "/workspace",
        image,
        "sh", "-c", script,
      ],
      { timeout: timeoutMs, reject: false, all: true }
    )
    return {
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? "",
      exitCode: result.exitCode ?? 0,
    }
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; message?: string }
    return {
      stdout: e.stdout ?? "",
      stderr: e.stderr ?? e.message ?? String(err),
      exitCode: 1,
    }
  }
}

// ─── Playwright JSON report parsing ──────────────────────────────────────────

async function parsePlaywrightOutput(
  worktreePath: string,
  reportPath: string
): Promise<{ testResults: TestResult[]; screenshots: string[]; traces: string[] }> {
  try {
    if (!(await fs.pathExists(reportPath))) return { testResults: [], screenshots: [], traces: [] }
    const raw = await fs.readJSON(reportPath)
    const parsed = parsePlaywrightReport(raw)
    await fs.remove(reportPath).catch(() => {})
    return { testResults: parsed.testResults, screenshots: parsed.screenshots, traces: parsed.traces }
  } catch {
    return { testResults: [], screenshots: [], traces: [] }
  }
}

// ─── Main entry ───────────────────────────────────────────────────────────────

export async function executeSandbox(
  worktreePath: string,
  runId: string,
  config: AgentConfig
): Promise<SandboxArtifact> {
  const started = Date.now()
  const sandboxCfg = config.sandbox
  const cmds = sandboxCfg?.commands ?? DEFAULT_COMMANDS
  const timeoutMs = sandboxCfg?.timeoutMs ?? DEFAULT_TIMEOUT

  // Playwright writes its JSON report to this path via PLAYWRIGHT_JSON_OUTPUT_NAME
  const playwrightReportPath = path.join(worktreePath, ".agent-playwright-report.json")

  // Non-Playwright phases (install, typecheck, test)
  const prePhases = [cmds.install, cmds.typecheck, cmds.test]
  // Playwright phase gets the env var injected
  const playwrightCmd = cmds.playwright

  let stdout = ""
  let stderr = ""
  let exitCode = 0
  let testResults: TestResult[] = []
  let screenshots: string[] = []
  let traces: string[] = []

  if (sandboxCfg?.docker) {
    // Docker mode: chain all phases except Playwright, then run Playwright separately
    // so we can inject PLAYWRIGHT_JSON_OUTPUT_NAME into the container env
    const preResult = await runInDocker(
      worktreePath, prePhases, sandboxCfg.image ?? DEFAULT_IMAGE, timeoutMs
    )
    stdout = preResult.stdout
    stderr = preResult.stderr
    exitCode = preResult.exitCode

    if (exitCode === 0 && playwrightCmd) {
      const pwResult = await runInDocker(
        worktreePath, [playwrightCmd], sandboxCfg.image ?? DEFAULT_IMAGE, timeoutMs
      )
      stdout += pwResult.stdout ? `\n[playwright]\n${pwResult.stdout}` : ""
      stderr += pwResult.stderr ? `\n[playwright]\n${pwResult.stderr}` : ""
      if (pwResult.exitCode !== 0) exitCode = pwResult.exitCode
      ;({ testResults, screenshots, traces } = await parsePlaywrightOutput(worktreePath, playwrightReportPath))
    }
  } else {
    // Host mode: sequential phases, stop on first failure
    for (const cmd of prePhases) {
      const result = await runPhase(cmd, worktreePath, timeoutMs)
      stdout += result.stdout ? `\n[${cmd}]\n${result.stdout}` : ""
      stderr += result.stderr ? `\n[${cmd}]\n${result.stderr}` : ""
      if (result.exitCode !== 0) { exitCode = result.exitCode; break }
    }

    if (exitCode === 0 && playwrightCmd) {
      const [bin, ...args] = playwrightCmd.split(" ")
      try {
        const pwResult = await execa(bin, [...args, "--reporter=json"], {
          cwd: worktreePath,
          timeout: timeoutMs,
          reject: false,
          all: true,
          env: { ...process.env, PLAYWRIGHT_JSON_OUTPUT_NAME: playwrightReportPath },
        })
        stdout += pwResult.stdout ? `\n[playwright]\n${pwResult.stdout}` : ""
        stderr += pwResult.stderr ? `\n[playwright]\n${pwResult.stderr}` : ""
        if (pwResult.exitCode !== 0) exitCode = pwResult.exitCode
      } catch { exitCode = 1 }
      ;({ testResults, screenshots, traces } = await parsePlaywrightOutput(worktreePath, playwrightReportPath))
    }
  }

  return {
    runId,
    stdout: stdout.trim(),
    stderr: stderr.trim(),
    exitCode,
    screenshots,
    traces,
    testResults,
    metrics: {
      durationMs: Date.now() - started,
      memoryMb:   0,
    },
  }
}
