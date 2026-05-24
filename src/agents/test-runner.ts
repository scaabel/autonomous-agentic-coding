import { execa } from "execa"
import fs from "fs-extra"
import path from "path"
import type { TestRunResult, FailedTest, Task } from "../core/types.js"
import { loadConfig } from "../core/config.js"
import { isMonorepo, resolveWorkspace } from "../core/workspace.js"

async function getTestResultsPath(): Promise<string> {
  const config = await loadConfig()
  return path.join(config.tracesDir, "test-results.json")
}

// ─── Run tests for a specific workspace (or root in single-project mode) ──────

export async function runCriticalPaths(workspace?: string): Promise<TestRunResult> {
  const testDir = await resolveTestDir(workspace)
  return runPlaywright([path.join(testDir, "critical-paths/")], "critical")
}

export async function runFeatureTests(
  testFiles: string[],
  workspace?: string
): Promise<TestRunResult> {
  if (testFiles.length === 0) return emptyPassResult()
  // Resolve test files to absolute paths
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
  return runPlaywright(resolved, "features")
}

export async function runFullSuite(workspace?: string): Promise<TestRunResult> {
  const testDir = await resolveTestDir(workspace)
  return runPlaywright([testDir + "/"], "full")
}

// ─── Run all workspaces in sequence ───────────────────────────────────────────

export async function runAllWorkspaceCriticalPaths(): Promise<TestRunResult> {
  const mono = await isMonorepo()
  if (!mono) return runCriticalPaths()

  const config = await loadConfig()
  const workspaceNames = Object.keys(config.workspaces ?? {})

  let combined: TestRunResult = emptyPassResult()

  for (const name of workspaceNames) {
    const result = await runCriticalPaths(name)
    if (result.status === "skipped") continue

    combined = mergeResults(combined, result)
    if (result.status === "fail" || result.status === "regression") {
      combined.status = result.status
    }
  }

  return combined
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

async function runPlaywright(
  patterns: string[],
  label: string
): Promise<TestRunResult> {
  const start = Date.now()
  const TEST_RESULTS_PATH = await getTestResultsPath()
  await fs.ensureDir(path.dirname(TEST_RESULTS_PATH))

  const args = [
    "playwright", "test",
    ...patterns,
    "--reporter=json",
    `--output=${TEST_RESULTS_PATH}`,
  ]

  try {
    await execa("npx", args, { reject: false, env: { ...process.env, FORCE_COLOR: "0" } })
  } catch {
    return { status: "skipped", total: 0, passed: 0, failed: 0, skipped: 0, duration_ms: Date.now() - start, failed_tests: [] }
  }

  const result = await parsePlaywrightResults(start)
  result.status = result.failed === 0 ? "pass" : "fail"
  return result
}

async function parsePlaywrightResults(startTime: number): Promise<TestRunResult> {
  const TEST_RESULTS_PATH = await getTestResultsPath()
  try {
    const raw = await fs.readJSON(TEST_RESULTS_PATH)
    const failedTests: FailedTest[] = []
    for (const suite of raw.suites ?? []) collectFailures(suite, failedTests)
    return {
      status: "pass",
      total: raw.stats?.total ?? 0,
      passed: raw.stats?.expected ?? 0,
      failed: raw.stats?.unexpected ?? 0,
      skipped: raw.stats?.skipped ?? 0,
      duration_ms: raw.stats?.duration ?? Date.now() - startTime,
      failed_tests: failedTests,
    }
  } catch { return emptyPassResult() }
}

function collectFailures(suite: any, acc: FailedTest[]): void {
  for (const test of suite.specs ?? []) {
    for (const result of test.tests ?? []) {
      if (result.status !== "expected") {
        acc.push({
          title: `${suite.title} > ${test.title}`,
          file: suite.file ?? "",
          error: result.results?.[0]?.error?.message ?? "Unknown error",
          duration_ms: result.results?.[0]?.duration ?? 0,
        })
      }
    }
  }
  for (const child of suite.suites ?? []) collectFailures(child, acc)
}

function mergeResults(a: TestRunResult, b: TestRunResult): TestRunResult {
  return {
    status: "pass",   // caller sets final status
    total: a.total + b.total,
    passed: a.passed + b.passed,
    failed: a.failed + b.failed,
    skipped: a.skipped + b.skipped,
    duration_ms: a.duration_ms + b.duration_ms,
    failed_tests: [...a.failed_tests, ...b.failed_tests],
  }
}

export async function detectCulpritTask(
  failedTests: FailedTest[],
  completedTasks: Task[]
): Promise<string | undefined> {
  if (completedTasks.length === 0) return undefined
  try {
    const { stdout } = await execa("git", ["log", `--oneline`, `-${completedTasks.length}`, "--format=%H %s"])
    const commits = stdout.trim().split("\n").map((line) => {
      const [hash, ...msgParts] = line.split(" ")
      return { hash, message: msgParts.join(" ") }
    })
    for (const task of [...completedTasks].reverse()) {
      const match = commits.find((c) => c.message.toLowerCase().includes(task.title.toLowerCase()))
      if (match) return task.id
    }
  } catch { }
  return undefined
}

function emptyPassResult(): TestRunResult {
  return { status: "pass", total: 0, passed: 0, failed: 0, skipped: 0, duration_ms: 0, failed_tests: [] }
}
