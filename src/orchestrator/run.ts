import fs from "fs-extra"
import path from "path"
import chalk from "chalk"
import ora from "ora"
import { v4 as uuid } from "uuid"
import { plannerAgent, contractExtractorAgent } from "../agents/planner.js"
import { runStep } from "./step-runner.js"
import { runCriticalPaths, runFeatureTests, runAllWorkspaceCriticalPaths } from "../agents/test-runner.js"
import { initRegistry, getRegistryPaths } from "../core/registry.js"
import { initOwnershipIndex } from "../core/kernel/ownership.js"
import { attributeRegressions, prepareLocalisedRetry } from "../core/attribution/regression.js"
import { isGitRepo, initGitRepo } from "../core/git.js"
import { loadConfig, isInitialised } from "../core/config.js"
import { checkBudgetBeforeRun, recordRunComplete } from "../core/budget.js"
import { isMonorepo } from "../core/workspace.js"
import { waitForEnter, askYesNo } from "../utils/input.js"
import type {
  Task,
  TaskQueue,
  ApiContract,
  RunTrace,
  StepTrace,
  CostSummary,
  TestRunResult,
} from "../core/types.js"

export type RunOptions = {
  interactive?: boolean
  docsDir?: string
  mockupsDir?: string
}

// Defaults resolved from config at runtime — see loadConfig()

export async function run(task: string, options: RunOptions = {}): Promise<void> {
  // Load config — merges .agent/config.json + env vars
  const config = await loadConfig()

  const interactive = options.interactive ?? config.requireApproval
  const docsDir     = options.docsDir    ?? config.docsDir
  const mockupsDir  = options.mockupsDir ?? config.mockupsDir

  const runId    = `run-${uuid()}`
  const startedAt = new Date().toISOString()

  // Guard: warn if not initialised
  if (!(await isInitialised())) {
    console.log(chalk.yellow("\n  ⚠ .agent/config.json not found. Run \`agent init\` first for best results.\n"))
  }

  // Guard: check monthly budget before spending any tokens
  const budgetOk = await checkBudgetBeforeRun()
  if (!budgetOk) return

  // ── Git setup ──────────────────────────────────────────────────────────────
  if (!(await isGitRepo())) {
    console.log(chalk.dim("  Initializing git repo..."))
    await initGitRepo()
  }

  await fs.ensureDir(docsDir)
  await fs.ensureDir(config.tracesDir)

  console.log(chalk.bold.cyan("\n┌─────────────────────────────────────┐"))
  console.log(chalk.bold.cyan("│        🧠 Agent System v0.3         │"))
  console.log(chalk.bold.cyan("└─────────────────────────────────────┘\n"))
  console.log(chalk.dim(`Run ID: ${runId}`))
  console.log(chalk.dim(`Task:   ${task}\n`))

  // ── Phase 1: Planning (skipped on resume) ─────────────────────────────────
  const p = await getRegistryPaths()
  const existingQueue = await fs.pathExists(p.taskQueue)
    ? await fs.readJSON(p.taskQueue) as TaskQueue
    : null
  const isResume = existingQueue !== null &&
    existingQueue.feature === task &&
    existingQueue.tasks.some((t: Task) => t.status === "pass" || t.status === "manually_completed")

  let allTasks: Task[]
  let apiContract: ApiContract

  if (isResume) {
    console.log(chalk.bold.yellow("  ↩ Resuming from existing task queue\n"))
    allTasks = existingQueue!.tasks
    apiContract = await fs.readJSON(p.apiContract) as ApiContract
  } else {
    console.log(chalk.bold("Phase 1 — Planning\n"))

    const planSpinner = ora("  Generating PRD and task breakdown...").start()
    let plan
    try {
      plan = await plannerAgent(task)
      planSpinner.succeed(chalk.green("  Plan generated"))
    } catch (err) {
      planSpinner.fail("  Planning failed")
      throw err
    }

    // ── Phase 2: Extract contracts ───────────────────────────────────────────
    const contractSpinner = ora("  Extracting API and UI contracts...").start()
    try {
      const contracts = await contractExtractorAgent(plan.summary, plan.be_steps, plan.fe_steps)
      apiContract = contracts.apiContract

      await fs.writeJSON(path.join(docsDir, "api-contract.json"), apiContract, { spaces: 2 })
      await fs.writeJSON(path.join(docsDir, "ui-contract.json"), contracts.uiContract, { spaces: 2 })
      await fs.writeJSON(path.join(docsDir, "prd.json"), {
        run_id: runId, task,
        summary: plan.summary,
        be_steps: plan.be_steps,
        fe_steps: plan.fe_steps,
      }, { spaces: 2 })
      contractSpinner.succeed(chalk.green("  Contracts written to docs/"))
    } catch (err) {
      contractSpinner.fail("  Contract extraction failed")
      throw err
    }

    // ── Phase 3: Build task queue + init all registries ──────────────────────
    allTasks = [
      ...plan.be_steps.map((s) => ({ ...s, status: "pending" as const, attempts: 0 })),
      ...plan.fe_steps.map((s) => ({ ...s, status: "pending" as const, attempts: 0 })),
    ]

    const taskQueue: TaskQueue = {
      run_id: runId,
      feature: task,
      created_at: startedAt,
      tasks: allTasks,
    }

    await fs.writeJSON(path.join(docsDir, "task-queue.json"), taskQueue, { spaces: 2 })
    await initRegistry(runId, task)
    await initOwnershipIndex(runId, allTasks)
    console.log(chalk.dim("  Ownership index initialised"))
  }

  // ── Human checkpoint (skipped on resume) ──────────────────────────────────
  if (interactive && !isResume) {
    console.log(chalk.bold.yellow("\n📋 Review before execution:\n"))
    console.log(chalk.dim("  docs/prd.json                        — full plan"))
    console.log(chalk.dim("  docs/api-contract.json               — endpoint contracts"))
    console.log(chalk.dim("  docs/ui-contract.json                — component contracts"))
    console.log(chalk.dim("  docs/task-queue.json                 — ordered task list"))
    console.log(chalk.dim("  docs/registry/ownership-index.json   — dependency graph\n"))
    printTaskSummary(
      allTasks.filter((t) => t.agent === "be"),
      allTasks.filter((t) => t.agent === "fe")
    )

    const approved = await askYesNo("Proceed with this plan?")
    if (!approved) {
      console.log(chalk.yellow("\nRun cancelled. Edit docs/ files and re-run.\n"))
      return
    }
  }

  // ── Phase 4: Execute ───────────────────────────────────────────────────────
  const completedIds = new Set<string>()
  const stepTraces: StepTrace[] = []
  let totalInputTokens = 0
  let totalOutputTokens = 0
  let firstPassCount = 0
  let retryCount = 0

  const beSteps = allTasks.filter((t) => t.agent === "be")
  const feSteps = allTasks.filter((t) => t.agent === "fe")

  for (const group of [beSteps, feSteps]) {
    const label = group[0]?.agent === "be" ? "BE" : "FE"
    if (group.length === 0) continue

    console.log(chalk.bold(`\nPhase — ${label} Steps\n`))

    for (const task of group) {
      // Skip already completed tasks (supports resume after partial run)
      if (task.status === "pass" || task.status === "manually_completed") {
        completedIds.add(task.id)
        console.log(chalk.dim(`  ↩ Skipping ${task.id} — already ${task.status}`))
        continue
      }

      // Check dependencies are satisfied (pass OR manually completed)
      const isResolved = (id: string) =>
        completedIds.has(id) ||
        allTasks.find((t) => t.id === id)?.status === "manually_completed"

      const blockedDep = task.depends_on.find((id) => !isResolved(id))
      if (blockedDep) {
        console.log(chalk.red(`  ⚠ Skipping ${task.id} — dependency ${blockedDep} not completed`))
        continue
      }

      const mockupPath = path.join(mockupsDir, `${task.id}.png`)
      const stepTrace = await runStep(task, apiContract!, mockupPath)
      stepTraces.push(stepTrace)

      for (const attempt of stepTrace.attempts) {
        totalInputTokens += attempt.input_tokens
        totalOutputTokens += attempt.output_tokens
      }
      if (stepTrace.attempts.length === 1 && stepTrace.status === "pass") firstPassCount++
      if (stepTrace.attempts.length > 1) retryCount++

      if (stepTrace.status === "pass") {
        completedIds.add(task.id)
      } else {
        const costSummary = buildCostSummary(
          allTasks.length, firstPassCount, retryCount,
          totalInputTokens, totalOutputTokens
        )
        await saveTrace(runId, task.description, startedAt, "blocked", stepTraces, costSummary)
        printCostSummary(costSummary)
        console.log(chalk.red(`\n🛑 Blocked on: ${task.title}`))
        console.log(chalk.dim("  Fix manually and re-run, or use `agent resume` (coming soon)\n"))
        return
      }
    }
  }

  // ── Phase 5: E2E Tests + Attribution ──────────────────────────────────────
  const completedTasksList = allTasks.filter((t) => completedIds.has(t.id))
  const mono = await isMonorepo()

  // Group new test files by workspace for correct path resolution
  const testFilesByWorkspace = new Map<string | undefined, string[]>()
  for (const t of completedTasksList) {
    if (!t.test_scope?.test_file) continue
    const key = t.workspace
    const existing = testFilesByWorkspace.get(key) ?? []
    testFilesByWorkspace.set(key, [...existing, t.test_scope.test_file])
  }

  console.log(chalk.bold("\nPhase — E2E Tests\n"))

  // 5a: Feature tests (smoke) — run per workspace
  if (testFilesByWorkspace.size > 0) {
    for (const [workspace, files] of testFilesByWorkspace.entries()) {
      const label = workspace ? `[${workspace}] ` : ""
      const featureSpinner = ora(`  ${label}Running ${files.length} feature test(s)...`).start()
      const featureResult = await runFeatureTests(files, workspace)

      if (featureResult.status === "skipped") {
        featureSpinner.warn(chalk.dim(`  ${label}Playwright not configured — skipping`))
      } else if (featureResult.status === "pass") {
        featureSpinner.succeed(
          chalk.green(`  ${label}Feature tests passed (${featureResult.passed}/${featureResult.total})`)
        )
      } else {
        featureSpinner.fail(chalk.red(`  ${label}Feature tests failed (${featureResult.failed} failures)`))
        featureResult.failed_tests.forEach((t) =>
          console.log(chalk.dim(`    • ${t.title}\n      ${t.error.split("\n")[0]}`))
        )

        // Attribution
        const report = await attributeRegressions(featureResult.failed_tests)
        await printAttributionReport(report)

        if (report.recommended_action === "retry_tasks") {
          const retried = await attemptLocalisedRetries(
            report, completedTasksList, apiContract!,
            stepTraces, totalInputTokens, totalOutputTokens
          )
          if (retried) {
            const retryFeatureResult = await runFeatureTests(files, workspace)
            if (retryFeatureResult.status === "pass") {
              console.log(chalk.green(`  ✓ Feature tests passed after localised retry`))
            } else {
              const costSummary = buildCostSummary(
                allTasks.length, firstPassCount, retryCount + 1,
                totalInputTokens, totalOutputTokens
              )
              await saveTrace(runId, task, startedAt, "blocked", stepTraces, costSummary, retryFeatureResult)
              printCostSummary(costSummary)
              console.log(chalk.red("\n🛑 Feature tests still failing after localised retry\n"))
              return
            }
          } else {
            const costSummary = buildCostSummary(
              allTasks.length, firstPassCount, retryCount,
              totalInputTokens, totalOutputTokens
            )
            await saveTrace(runId, task, startedAt, "blocked", stepTraces, costSummary, featureResult)
            printCostSummary(costSummary)
            console.log(chalk.red("\n🛑 Feature tests failed — manual review required\n"))
            return
          }
        } else {
          const costSummary = buildCostSummary(
            allTasks.length, firstPassCount, retryCount,
            totalInputTokens, totalOutputTokens
          )
          await saveTrace(runId, task, startedAt, "blocked", stepTraces, costSummary, featureResult)
          printCostSummary(costSummary)
          return
        }
      }   // end else (test failed)
    }     // end for workspace loop
  }       // end if testFilesByWorkspace.size > 0

  // 5b: Critical paths — all workspaces in monorepo, or single project
  const cpSpinner = ora("  Running critical paths...").start()
  const cpResult = mono
    ? await runAllWorkspaceCriticalPaths()
    : await runCriticalPaths()

  if (cpResult.status === "skipped") {
    cpSpinner.warn(chalk.dim("  No critical paths configured yet"))
  } else if (cpResult.status === "pass") {
    cpSpinner.succeed(
      chalk.green(`  Critical paths passed (${cpResult.passed}/${cpResult.total})`)
    )
  } else {
    cpSpinner.fail(chalk.red(`  Regression — ${cpResult.failed} critical path(s) failed`))
    cpResult.failed_tests.forEach((t) =>
      console.log(chalk.dim(`    • ${t.title}\n      ${t.error.split("\n")[0]}`))
    )

    // Attribution on regression
    const report = await attributeRegressions(cpResult.failed_tests)
    await printAttributionReport(report)

    if (report.recommended_action === "retry_tasks") {
      const retried = await attemptLocalisedRetries(
        report, completedTasksList, apiContract!,
        stepTraces, totalInputTokens, totalOutputTokens
      )
      if (retried) {
        const retryCpResult = await runCriticalPaths()
        if (retryCpResult.status === "pass") {
          console.log(chalk.green("  ✓ Critical paths passed after localised retry"))
        } else {
          const costSummary = buildCostSummary(
            allTasks.length, firstPassCount, retryCount + 1,
            totalInputTokens, totalOutputTokens
          )
          await saveTrace(runId, task, startedAt, "blocked", stepTraces, costSummary, retryCpResult)
          printCostSummary(costSummary)
          console.log(chalk.red("\n🛑 Regression persists after localised retry\n"))
          return
        }
      } else {
        const costSummary = buildCostSummary(
          allTasks.length, firstPassCount, retryCount,
          totalInputTokens, totalOutputTokens
        )
        await saveTrace(runId, task, startedAt, "blocked", stepTraces, costSummary, cpResult)
        printCostSummary(costSummary)
        console.log(chalk.red("\n🛑 Run blocked — regression in critical paths\n"))
        return
      }
    } else {
      const costSummary = buildCostSummary(
        allTasks.length, firstPassCount, retryCount,
        totalInputTokens, totalOutputTokens
      )
      await saveTrace(runId, task, startedAt, "blocked", stepTraces, costSummary, cpResult)
      printCostSummary(costSummary)
      console.log(chalk.red("\n🛑 Run blocked — manual review required\n"))
      return
    }
  }

  // ── Finalize ───────────────────────────────────────────────────────────────
  const costSummary = buildCostSummary(
    allTasks.length, firstPassCount, retryCount,
    totalInputTokens, totalOutputTokens
  )
  const tracePath = await saveTrace(runId, task, startedAt, "complete", stepTraces, costSummary)
  await recordRunComplete(costSummary.estimated_cost_usd)
  printCostSummary(costSummary)
  console.log(chalk.bold.green(`\n✅ Run complete — ${completedIds.size}/${allTasks.length} tasks, all tests passed`))
  console.log(chalk.dim(`   Trace: ${tracePath}\n`))
}

// ─── Localised retry orchestration ───────────────────────────────────────────

async function attemptLocalisedRetries(
  report: Awaited<ReturnType<typeof attributeRegressions>>,
  completedTasks: Task[],
  apiContract: ApiContract,
  stepTraces: StepTrace[],
  totalInputTokens: number,
  totalOutputTokens: number
): Promise<boolean> {
  const localisable = report.attributions.filter((a) => a.localised_retry && a.confidence === "high")
  if (localisable.length === 0) return false

  for (const attribution of localisable) {
    const retryPrep = await prepareLocalisedRetry(attribution, completedTasks)
    if (!retryPrep) continue

    console.log(chalk.yellow(
      `\n  🔁 Localised retry: ${attribution.culprit_task_id} (${attribution.confidence} confidence)`
    ))
    if (retryPrep.stale_consumers.length > 0) {
      console.log(chalk.dim(
        `     Stale consumers: ${retryPrep.stale_consumers.join(", ")}`
      ))
    }

    const config2 = await loadConfig()
    const mockupPath = path.join(config2.mockupsDir, `${retryPrep.task.id}.png`)
    const retryTrace = await runStep(retryPrep.task, apiContract, mockupPath)
    stepTraces.push(retryTrace)

    if (retryTrace.status !== "pass") {
      console.log(chalk.red(`  Localised retry failed for ${attribution.culprit_task_id}`))
      return false
    }
  }

  return true
}

// ─── Attribution report printer ───────────────────────────────────────────────

async function printAttributionReport(
  report: Awaited<ReturnType<typeof attributeRegressions>>
): Promise<void> {
  if (report.attributions.length === 0) {
    console.log(chalk.dim("  Could not attribute failures to specific tasks"))
    return
  }

  console.log(chalk.bold.yellow("\n  📍 Regression Attribution\n"))
  for (const a of report.attributions) {
    const icon = a.confidence === "high" ? "●" : a.confidence === "medium" ? "◐" : "○"
    const color = a.confidence === "high" ? chalk.red : a.confidence === "medium" ? chalk.yellow : chalk.dim
    console.log(color(`  ${icon} ${a.culprit_task_id}: ${a.culprit_task_title}`))
    console.log(chalk.dim(`    Confidence: ${a.confidence}`))
    console.log(chalk.dim(`    Tests:      ${a.affected_tests.join(", ")}`))
    console.log(chalk.dim(`    Action:     ${a.localised_retry ? "localised retry" : "manual review"}\n`))
  }

  if (report.unattributed_tests.length > 0) {
    console.log(chalk.dim(`  Unattributed: ${report.unattributed_tests.join(", ")}`))
  }

  console.log(chalk.dim(`  Recommended: ${report.recommended_action}\n`))
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function printTaskSummary(beSteps: Task[], feSteps: Task[]): void {
  console.log(chalk.bold("  BE Steps:"))
  beSteps.forEach((s) => console.log(`    ${chalk.dim(s.id)}  ${s.title}`))
  console.log(chalk.bold("\n  FE Steps:"))
  feSteps.forEach((s) => console.log(`    ${chalk.dim(s.id)}  ${s.title}`))
  console.log()
}

function buildCostSummary(
  total: number,
  firstPass: number,
  retries: number,
  inputTokens: number,
  outputTokens: number
): CostSummary {
  const estimatedCost = (inputTokens / 1_000_000) * 2.5 + (outputTokens / 1_000_000) * 12.0
  return {
    total_tasks: total,
    first_pass_count: firstPass,
    retry_count: retries,
    total_input_tokens: inputTokens,
    total_output_tokens: outputTokens,
    estimated_cost_usd: Math.round(estimatedCost * 10000) / 10000,
  }
}

function printCostSummary(s: CostSummary): void {
  const rate = s.total_tasks > 0 ? Math.round((s.first_pass_count / s.total_tasks) * 100) : 0
  console.log(chalk.bold("\n  Cost Summary"))
  console.log(chalk.dim(`  Tasks:           ${s.first_pass_count}/${s.total_tasks} first-pass (${rate}%)`))
  console.log(chalk.dim(`  Retries:         ${s.retry_count}`))
  console.log(chalk.dim(`  Tokens in/out:   ${s.total_input_tokens.toLocaleString()} / ${s.total_output_tokens.toLocaleString()}`))
  console.log(chalk.dim(`  Estimated cost:  $${s.estimated_cost_usd.toFixed(4)}`))
}

async function saveTrace(
  id: string,
  task: string,
  startedAt: string,
  status: RunTrace["status"],
  steps: StepTrace[],
  costSummary: CostSummary,
  testResult?: TestRunResult
): Promise<string> {
  const config = await loadConfig()
  const trace: RunTrace & { test_result?: TestRunResult } = {
    id, task,
    started_at: startedAt,
    finished_at: new Date().toISOString(),
    status, steps,
    cost_summary: costSummary,
    test_result: testResult,
  }
  await fs.ensureDir(config.tracesDir)
  const tracePath = path.join(config.tracesDir, `${id}.json`)
  await fs.writeJSON(tracePath, trace, { spaces: 2 })
  return tracePath
}
