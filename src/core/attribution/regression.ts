import fs from "fs-extra"
import type { FailedTest, Task, TaskQueue } from "../types.js"
import {
  readOwnershipIndex,
  getTaskForTest,
  markTaskStale,
} from "../kernel/ownership.js"
import { getRegistryPaths } from "../registry.js"

// ─── Types ────────────────────────────────────────────────────────────────────

export type AttributionResult = {
  culprit_task_id: string
  culprit_task_title: string
  affected_tests: string[]
  confidence: "high" | "medium" | "low"
  reason: string
  localised_retry: boolean    // true if only this task needs retry, not full run
}

export type RegressionReport = {
  attributions: AttributionResult[]
  unattributed_tests: string[]
  recommended_action: "retry_tasks" | "manual_review" | "block_run"
}

// ─── Main: attribute failing tests to tasks ───────────────────────────────────

export async function attributeRegressions(
  failedTests: FailedTest[]
): Promise<RegressionReport> {
  const attributions: AttributionResult[] = []
  const unattributed: string[] = []
  const culpritMap = new Map<string, FailedTest[]>()

  // ── Pass 1: Direct test→task lookup (O(1) per test) ───────────────────────
  for (const test of failedTests) {
    const taskId = await getTaskForTest(test.file)

    if (taskId) {
      const existing = culpritMap.get(taskId) ?? []
      culpritMap.set(taskId, [...existing, test])
      continue
    }

    // ── Pass 2: File ownership lookup (find which task owns the tested file) ─
    const inferredTaskId = await inferTaskFromTestContent(test)
    if (inferredTaskId) {
      const existing = culpritMap.get(inferredTaskId) ?? []
      culpritMap.set(inferredTaskId, [...existing, test])
      continue
    }

    unattributed.push(test.title)
  }

  // ── Build attribution results ─────────────────────────────────────────────
  for (const [taskId, tests] of culpritMap.entries()) {
    const task = await findTask(taskId)
    const confidence = await calculateConfidence(taskId, tests)

    attributions.push({
      culprit_task_id: taskId,
      culprit_task_title: task?.title ?? taskId,
      affected_tests: tests.map((t) => t.title),
      confidence,
      reason: buildReason(taskId, tests, confidence),
      localised_retry: confidence === "high" && tests.length < failedTests.length,
    })
  }

  // Sort by number of affected tests descending
  attributions.sort((a, b) => b.affected_tests.length - a.affected_tests.length)

  return {
    attributions,
    unattributed_tests: unattributed,
    recommended_action: determineAction(attributions, unattributed),
  }
}

// ─── Localised retry: only the attributed task, not the full run ──────────────

export async function prepareLocalisedRetry(
  attribution: AttributionResult,
  allTasks: Task[]
): Promise<{
  task: Task
  stale_consumers: string[]
} | null> {
  const task = allTasks.find((t) => t.id === attribution.culprit_task_id)
  if (!task) return null

  // Mark the culprit task's outputs as stale so consumers know to re-read
  await markTaskStale(attribution.culprit_task_id)

  // Find downstream tasks that consumed this task's outputs
  const index = await readOwnershipIndex()
  const staleConsumers: string[] = []

  for (const record of Object.values(index.files)) {
    if (record.owned_by === attribution.culprit_task_id) {
      staleConsumers.push(...record.consumers)
    }
  }

  return {
    task,
    stale_consumers: [...new Set(staleConsumers)],
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function inferTaskFromTestContent(test: FailedTest): Promise<string | null> {
  // Check if the test file path contains a feature name that maps to a task
  const index = await readOwnershipIndex()

  // Extract feature name from test file path
  // e.g. tests/e2e/features/auth/login-form.e2e.ts → "auth", "login-form"
  const pathParts = test.file.split("/")
  const featureParts = pathParts.slice(pathParts.indexOf("features") + 1)

  // Find a file in the ownership index whose task matches the feature path
  for (const [filePath, record] of Object.entries(index.files)) {
    if (featureParts.some((part) => filePath.includes(part))) {
      return record.owned_by
    }
  }

  return null
}

async function calculateConfidence(
  taskId: string,
  tests: FailedTest[]
): Promise<"high" | "medium" | "low"> {
  const index = await readOwnershipIndex()

  // High: direct test-to-task mapping via test_scope
  const hasDirectMapping = tests.every((t) =>
    index.test_to_task[t.file] === taskId
  )
  if (hasDirectMapping) return "high"

  // Medium: test file path matches task's owned source files
  const taskFiles = Object.values(index.files)
    .filter((f) => f.owned_by === taskId)
    .map((f) => f.path)

  const hasFileOverlap = tests.some((t) =>
    taskFiles.some((f) => t.file.includes(f.replace(/\.[^.]+$/, "")))
  )
  if (hasFileOverlap) return "medium"

  return "low"
}

function buildReason(
  taskId: string,
  tests: FailedTest[],
  confidence: "high" | "medium" | "low"
): string {
  const testList = tests.map((t) => `"${t.title}"`).join(", ")

  if (confidence === "high") {
    return `Task ${taskId} owns the test file(s) for: ${testList}`
  }
  if (confidence === "medium") {
    return `Task ${taskId} owns source files likely tested by: ${testList}`
  }
  return `Task ${taskId} is a probable contributor to: ${testList} (low confidence)`
}

function determineAction(
  attributions: AttributionResult[],
  unattributed: string[]
): RegressionReport["recommended_action"] {
  // All failures attributed with high confidence and localisable → retry
  const allHighConfidence = attributions.every((a) => a.confidence === "high")
  const allLocalisable = attributions.every((a) => a.localised_retry)

  if (allHighConfidence && allLocalisable && unattributed.length === 0) {
    return "retry_tasks"
  }

  // Some unattributed or low confidence → manual review
  if (unattributed.length > 0 || attributions.some((a) => a.confidence === "low")) {
    return "manual_review"
  }

  // Multiple culprits with cross-task failures → block
  if (attributions.length > 2) {
    return "block_run"
  }

  return "retry_tasks"
}

async function findTask(taskId: string): Promise<Task | null> {
  try {
    const p = await getRegistryPaths()
  const queue = await fs.readJSON(p.taskQueue) as TaskQueue
    return queue.tasks.find((t: Task) => t.id === taskId) ?? null
  } catch {
    return null
  }
}
