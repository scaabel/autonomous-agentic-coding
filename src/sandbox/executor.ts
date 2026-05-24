import { execa } from "execa"
import path from "path"
import type { AgentConfig } from "../core/config.js"
import type { SandboxArtifact, TestResult } from "../core/failures/types.js"

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

// ─── Test result parsing ──────────────────────────────────────────────────────
// Parses basic pass/fail lines from test output.
// Full Playwright JSON parsing is Phase 2 (Observability Core).

function parseTestResults(stdout: string): TestResult[] {
  const results: TestResult[] = []
  // Match "✓ test name (Xms)" and "✗ test name" from common reporters
  const passLine = /[✓✔]\s+(.+?)\s+\((\d+)ms\)/g
  const failLine = /[✗✘×]\s+(.+?)(?:\s+\((\d+)ms\))?$/gm

  let m: RegExpExecArray | null
  while ((m = passLine.exec(stdout)) !== null) {
    results.push({ name: m[1], status: "passed", durationMs: parseInt(m[2], 10) })
  }
  while ((m = failLine.exec(stdout)) !== null) {
    results.push({ name: m[1], status: "failed", durationMs: m[2] ? parseInt(m[2], 10) : 0 })
  }
  return results
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

  const phases = [
    cmds.install,
    cmds.typecheck,
    cmds.test,
    ...(cmds.playwright ? [cmds.playwright] : []),
  ]

  let stdout = ""
  let stderr = ""
  let exitCode = 0

  if (sandboxCfg?.docker) {
    // Docker mode: single container run, all phases chained
    const result = await runInDocker(
      worktreePath,
      phases,
      sandboxCfg.image ?? DEFAULT_IMAGE,
      timeoutMs
    )
    stdout = result.stdout
    stderr = result.stderr
    exitCode = result.exitCode
  } else {
    // Host mode: run each phase sequentially in the worktree directory
    for (const cmd of phases) {
      const result = await runPhase(cmd, worktreePath, timeoutMs)
      stdout += result.stdout ? `\n[${cmd}]\n${result.stdout}` : ""
      stderr += result.stderr ? `\n[${cmd}]\n${result.stderr}` : ""
      if (result.exitCode !== 0) {
        exitCode = result.exitCode
        break // stop on first failing phase
      }
    }
  }

  const testResults = parseTestResults(stdout)
  // Playwright screenshots/traces are written to the worktree's playwright-report dir
  const reportDir = path.join(worktreePath, "playwright-report")

  return {
    runId,
    stdout: stdout.trim(),
    stderr: stderr.trim(),
    exitCode,
    screenshots: [], // populated in Phase 2 by scanning reportDir
    traces:      [], // populated in Phase 2 by scanning reportDir
    testResults,
    metrics: {
      durationMs: Date.now() - started,
      memoryMb:   0, // populated in Phase 2 via docker stats
    },
  }
}
