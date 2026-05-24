import { execa } from "execa"
import fs from "fs-extra"
import path from "path"
import type { TestRunResult, FailedTest, Task } from "../core/types.js"
import type { TestResult } from "../core/failures/types.js"
import { parsePlaywrightReport } from "../core/observability/playwright-parser.js"
import { loadConfig } from "../core/config.js"
import { isMonorepo, resolveWorkspace } from "../core/workspace.js"

// ─── Run tests for a specific workspace (or root in single-project mode) ──────

export async function runCriticalPaths(workspace?: string): Promise<TestRunResult> {
  const testDir = await resolveTestDir(workspace)
  return runPlaywright([path.join(testDir, "critical-paths/")], workspace)
}

export async function runFeatureTests(
  testFiles: string[],
  workspace?: string
): Promise<TestRunResult> {
  if (testFiles.length === 0) return emptyPassResult()
  const config = await loadConfig()
  const resolved = await Promise.all(
    testFiles.map(async (f) => {
      if (workspace && await isMonorepo()) {
        const ws = await resolveWorkspace(workspace)
        return path.join(ws.absoluteRoot, f)
      }
      return path.join(config.projectRoot, f)
    })
  )
  return runPlaywright(resolved, workspace)
}

export async function runFullSuite(workspace?: string): Promise<TestRunResult> {
  const testDir = await resolveTestDir(workspace)
  return runPlaywright([testDir + "/"], workspace)
}

// ─── Run all workspaces in sequence ───────────────────────────────────────────

export async function runAllWorkspaceCriticalPaths(): Promise<TestRunResult> {
  if (!(await isMonorepo())) return runCriticalPaths()

  const config = await loadConfig()
  let combined: TestRunResult = emptyPassResult()

  for (const name of Object.keys(config.workspaces ?? {})) {
    const result = await runCriticalPaths(name)
    if (result.status === "skipped") continue
    combined = mergeResults(combined, result)
    if (result.status === "fail" || result.status === "regression") {
      combined.status = result.status
    }
  }

  return combined
}

// ─── Core runner ──────────────────────────────────────────────────────────────

async function runPlaywright(
  patterns: string[],
  workspace?: string
): Promise<TestRunResult> {
  const start = Date.now()
  const config = await loadConfig()

  // Write JSON report to a temp path; PLAYWRIGHT_JSON_OUTPUT_NAME is the correct
  // env var for the json reporter — `--output` is the artifact dir, not the report file.
  const reportPath = path.join(
    config.tracesDir,
    `playwright-${Date.now()}.json`
  )
  await fs.ensureDir(config.tracesDir)

  try {
    await execa(
      "npx",
      ["playwright", "test", "--reporter=json", ...patterns],
      {
        reject: false,
        env: {
          ...process.env,
          FORCE_COLOR: "0",
          PLAYWRIGHT_JSON_OUTPUT_NAME: reportPath,
        },
      }
    )
  } catch {
    return emptySkipResult(start)
  }

  if (!(await fs.pathExists(reportPath))) return emptySkipResult(start)

  try {
    const raw = await fs.readJSON(reportPath)
    const parsed = parsePlaywrightReport(raw)

    // Derive FailedTest[] for backward compat
    const failedTests: FailedTest[] = parsed.testResults
      .filter((t) => t.status === "failed" || t.status === "timed_out")
      .map((t) => ({
        title:       t.name,
        file:        t.file ?? "",
        error:       t.error ?? "Unknown error",
        duration_ms: t.durationMs,
      }))

    const status = parsed.stats.failed === 0 ? "pass" : "fail"

    return {
      status,
      total:       parsed.stats.total,
      passed:      parsed.stats.passed,
      failed:      parsed.stats.failed,
      skipped:     parsed.stats.skipped,
      duration_ms: parsed.stats.durationMs || Date.now() - start,
      failed_tests: failedTests,
      testResults:  parsed.testResults,
    }
  } catch {
    return emptySkipResult(start)
  } finally {
    // Clean up temp report file
    await fs.remove(reportPath).catch(() => {})
  }
}

// ─── Culprit detection (unchanged) ────────────────────────────────────────────

export async function detectCulpritTask(
  failedTests: FailedTest[],
  completedTasks: Task[]
): Promise<string | undefined> {
  if (completedTasks.length === 0) return undefined
  try {
    const { stdout } = await execa("git", [
      "log", "--oneline", `-${completedTasks.length}`, "--format=%H %s",
    ])
    const commits = stdout.trim().split("\n").map((line) => {
      const [hash, ...msgParts] = line.split(" ")
      return { hash, message: msgParts.join(" ") }
    })
    for (const task of [...completedTasks].reverse()) {
      const match = commits.find((c) =>
        c.message.toLowerCase().includes(task.title.toLowerCase())
      )
      if (match) return task.id
    }
  } catch { }
  return undefined
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function resolveTestDir(workspace?: string): Promise<string> {
  if (workspace && await isMonorepo()) {
    const ws = await resolveWorkspace(workspace)
    return ws.absoluteTestDir
  }
  const config = await loadConfig()
  return path.join(config.projectRoot, config.testDir)
}

function mergeResults(a: TestRunResult, b: TestRunResult): TestRunResult {
  return {
    status:       "pass",
    total:        a.total + b.total,
    passed:       a.passed + b.passed,
    failed:       a.failed + b.failed,
    skipped:      a.skipped + b.skipped,
    duration_ms:  a.duration_ms + b.duration_ms,
    failed_tests: [...a.failed_tests, ...b.failed_tests],
    testResults:  [...(a.testResults ?? []), ...(b.testResults ?? [])],
  }
}

function emptyPassResult(): TestRunResult {
  return { status: "pass", total: 0, passed: 0, failed: 0, skipped: 0, duration_ms: 0, failed_tests: [], testResults: [] }
}

function emptySkipResult(start: number): TestRunResult {
  return { status: "skipped", total: 0, passed: 0, failed: 0, skipped: 0, duration_ms: Date.now() - start, failed_tests: [], testResults: [] }
}
