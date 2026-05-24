import chalk from "chalk"
import ora from "ora"
import { runBuilder } from "../agents/builder.js"
import { runReviewer } from "../agents/reviewer.js"
import { runDesigner } from "../agents/designer.js"
import { applyChanges } from "../utils/file.js"
import { gitCommit, getDiff } from "../core/git.js"
import {
  applyRegistryUpdates,
  appendJournal,
  updateTaskStatus,
} from "../core/registry.js"
import {
  registerOwnership,
  registerConsumer,
  markTaskStale,
} from "../core/kernel/ownership.js"
import { buildScopedContext } from "../core/context/scoped-context.js"
import { runStaticValidation } from "../core/validation/static-validators.js"
import type {
  Task,
  ApiContract,
  StepTrace,
  AttemptTrace,
  DesignSpec,
} from "../core/types.js"

const MAX_RETRIES = parseInt(process.env.MAX_RETRIES ?? "2", 10)

export async function runStep(
  task: Task,
  apiContract: ApiContract,
  mockupPath?: string
): Promise<StepTrace> {
  const trace: StepTrace = { task, attempts: [], status: "fail" }
  let feedback: string[] = []

  await updateTaskStatus(task.id, "in_progress", 0)

  // Register this task as a consumer of its files_to_read
  for (const filePath of task.scope.files_to_read) {
    await registerConsumer(filePath, task.id)
  }

  // ── Designer phase (FE tasks only) ────────────────────────────────────────
  let designSpec: DesignSpec | null = null

  if (task.agent === "fe") {
    const designSpinner = ora(`  [DESIGN] ${task.title}`).start()
    try {
      const designResult = await runDesigner(task, mockupPath)
      designSpec = designResult.output.spec
      designSpinner.succeed(chalk.cyan(`  [DESIGN] ${task.title} — spec approved`))
    } catch (err) {
      designSpinner.fail(chalk.red(`  [DESIGN] ${task.title} — failed`))
      throw err
    }
  }

  // ── Build → Validate → Review loop ───────────────────────────────────────
  for (let attempt = 1; attempt <= MAX_RETRIES + 1; attempt++) {
    const spinner = ora(
      `  [${task.agent.toUpperCase()}] ${task.title} — attempt ${attempt}`
    ).start()

    try {
      // ── Build (uses scoped context engine) ────────────────────────────────
      const { output: build, response: buildRes } = await runBuilder(
        task, apiContract, designSpec, feedback
      )

      // ── Static validation (no LLM — runs before reviewer) ─────────────────
      spinner.text = `  [${task.agent.toUpperCase()}] ${task.title} — validating...`
      const staticResult = await runStaticValidation(task, build, apiContract, designSpec)

      if (!staticResult.passed) {
        spinner.fail(
          chalk.red(`  [${task.agent.toUpperCase()}] ${task.title} — static validation failed`)
        )

        // Format static errors as feedback for the next attempt
        const staticFeedback = staticResult.errors.map(
          (e) => `[${e.code}] ${e.message}${e.file ? ` (${e.file})` : ""}`
        )
        console.log(chalk.red("    Static errors:"))
        staticFeedback.forEach((f) => console.log(chalk.dim(`      • ${f}`)))

        if (staticResult.warnings.length > 0) {
          console.log(chalk.yellow("    Warnings:"))
          staticResult.warnings.forEach((w) =>
            console.log(chalk.dim(`      ⚠ [${w.code}] ${w.message}`))
          )
        }

        await appendJournal({
          task_id: task.id, attempt, type: "validator_fail",
          content: `Static validation failed: ${staticFeedback.join("; ")}`,
          timestamp: new Date().toISOString(),
        })

        // Static errors count as a failed attempt — feed back without LLM review
        feedback = [
          ...staticFeedback,
          ...staticResult.warnings.map((w) => `[WARNING] ${w.message}`),
        ]
        continue
      }

      // Print warnings even on pass
      if (staticResult.warnings.length > 0) {
        staticResult.warnings.forEach((w) =>
          console.log(chalk.dim(`      ⚠ ${w.message}`))
        )
      }

      // ── Apply file changes (workspace-aware path resolution) ──────────────
      await applyChanges(build.changes, task.workspace)

      // ── Commit ────────────────────────────────────────────────────────────
      await gitCommit(
        `[${task.agent}] ${task.title}${attempt > 1 ? ` (retry ${attempt - 1})` : ""}`
      )

      const diff = await getDiff()

      // ── LLM Reviewer (only runs after static validation passes) ───────────
      spinner.text = `  [${task.agent.toUpperCase()}] ${task.title} — reviewing...`
      const { output: review, response: reviewRes } = await runReviewer(
        task, diff, apiContract, designSpec
      )

      const attemptTrace: AttemptTrace = {
        attempt,
        build,
        review,
        diff,
        input_tokens: buildRes.input_tokens + reviewRes.input_tokens,
        output_tokens: buildRes.output_tokens + reviewRes.output_tokens,
        timestamp: new Date().toISOString(),
      }
      trace.attempts.push(attemptTrace)

      if (review.verdict === "pass") {
        // ── Apply registry updates ─────────────────────────────────────────
        await applyRegistryUpdates(build.registry_updates, task.id)

        // ── Register ownership in kernel ───────────────────────────────────
        await registerOwnership(
          build.registry_updates,
          task.id,
          task.agent,
          attempt
        )

        // ── Append decisions to journal ────────────────────────────────────
        for (const decision of build.decisions) {
          await appendJournal({
            task_id: task.id, attempt, type: "decision",
            content: decision,
            files_affected: build.changes.map((c) => c.file),
            timestamp: new Date().toISOString(),
          })
        }

        await appendJournal({
          task_id: task.id, attempt, type: "validator_pass",
          content: `All ${review.criteria_results.length} criteria passed. Static: ${staticResult.errors.length} errors, ${staticResult.warnings.length} warnings.`,
          files_affected: build.changes.map((c) => c.file),
          timestamp: new Date().toISOString(),
        })

        await updateTaskStatus(task.id, "pass", attempt)
        trace.status = "pass"
        spinner.succeed(chalk.green(`  [${task.agent.toUpperCase()}] ${task.title}`))
        return trace
      }

      // ── Review failed ─────────────────────────────────────────────────────
      spinner.fail(
        chalk.yellow(`  [${task.agent.toUpperCase()}] ${task.title} — attempt ${attempt} failed`)
      )
      review.feedback.forEach((f) => console.log(chalk.dim(`      • ${f}`)))

      await appendJournal({
        task_id: task.id, attempt, type: "validator_fail",
        content: review.feedback.join("; "),
        files_affected: build.changes.map((c) => c.file),
        timestamp: new Date().toISOString(),
      })

      feedback = review.feedback

      // Mark this task's outputs as stale so consumers know to re-check
      if (attempt < MAX_RETRIES + 1) {
        await markTaskStale(task.id)
      }

    } catch (err) {
      spinner.fail(chalk.red(`  [${task.agent.toUpperCase()}] ${task.title} — error`))
      console.error(chalk.red(`    ${err}`))
      feedback = [`Runtime error on attempt ${attempt}: ${err}`]
    }
  }

  // ── Blocked ────────────────────────────────────────────────────────────────
  await updateTaskStatus(task.id, "blocked", MAX_RETRIES + 1)
  await appendJournal({
    task_id: task.id, attempt: MAX_RETRIES + 1, type: "validator_fail",
    content: `BLOCKED after ${MAX_RETRIES + 1} attempts. Last: ${feedback.join("; ")}`,
    timestamp: new Date().toISOString(),
  })

  trace.status = "blocked"
  return trace
}
