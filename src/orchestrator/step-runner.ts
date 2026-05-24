import chalk from "chalk"
import ora from "ora"
import { runBuilder } from "../agents/builder.js"
import { runReviewer } from "../agents/reviewer.js"
import { runDesigner } from "../agents/designer.js"
import { applyChanges } from "../utils/file.js"
import {
  createWorktree,
  removeWorktree,
  commitInWorktree,
  getDiffFromWorktree,
  cherryPickToMain,
} from "../core/git.js"
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
import { normalizeValidationError, normalizeValidationWarning, normalizeRuntimeError } from "../core/failures/normalize.js"
import { executeSandbox } from "../sandbox/executor.js"
import { loadConfig } from "../core/config.js"
import {
  dispatchMutation,
  dispatchGate,
  dispatchNotification,
} from "../core/hooks/dispatcher.js"
import type {
  Task,
  ApiContract,
  StepTrace,
  AttemptTrace,
  DesignSpec,
} from "../core/types.js"
import type { NormalizedFailure } from "../core/failures/types.js"
import type { RetryHistory, DiagnosisRecord } from "../core/retry/types.js"
import type { ConfidenceResult } from "../core/confidence/types.js"

const MAX_RETRIES = parseInt(process.env.MAX_RETRIES ?? "2", 10)

// ─── Confidence stub ──────────────────────────────────────────────────────────
// Full confidence engine is Phase 5. This stub maintains existing auto-commit
// behavior (always high confidence when review passes) while wiring the gate.

function buildConfidence(
  attempt: number,
  reviewPassRate: number,
  staticErrorCount: number
): ConfidenceResult {
  const score = staticErrorCount === 0 && reviewPassRate >= 1.0 && attempt === 1 ? 1.0
    : staticErrorCount === 0 && reviewPassRate >= 0.8 ? 0.75
    : 0.4

  const tier: ConfidenceResult["tier"] =
    score >= 0.9 ? "high" : score >= 0.6 ? "medium" : "low"

  return {
    score,
    tier,
    signals: {
      staticPassRate:      staticErrorCount === 0 ? 1 : 0,
      reviewPassRate,
      runtimePassRate:     1, // updated in Phase 2 from sandbox TestResult[]
      attemptNumber:       attempt,
      ownershipCompliance: 1, // updated when ownership violations detected
    },
    explanation: [
      staticErrorCount === 0 ? "static checks passed" : `${staticErrorCount} static errors`,
      `reviewer pass rate ${Math.round(reviewPassRate * 100)}%`,
      attempt > 1 ? `attempt ${attempt}` : "first pass",
    ],
  }
}

// ─── Step runner ──────────────────────────────────────────────────────────────

export async function runStep(
  task: Task,
  apiContract: ApiContract,
  mockupPath?: string
): Promise<StepTrace> {
  const config = await loadConfig()
  const trace: StepTrace = { task, attempts: [], status: "fail" }
  let feedback: string[] = []

  const retryHistory: RetryHistory = {
    attempts: 0,
    failures: [],
    diagnoses: [] as DiagnosisRecord[],
    lastFeedback: [],
  }

  await updateTaskStatus(task.id, "in_progress", 0)

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

    retryHistory.attempts = attempt
    retryHistory.lastFeedback = feedback

    // Each attempt runs in an isolated git worktree
    let worktreePath = ""
    try {
      worktreePath = await createWorktree(`${task.id}-${attempt}`)
    } catch (err) {
      spinner.fail(chalk.red(`  [${task.agent.toUpperCase()}] ${task.title} — worktree failed`))
      console.error(chalk.red(`    Could not create worktree: ${err}`))
      feedback = [`Worktree creation failed: ${err}`]
      continue
    }

    try {
      // ── Build ─────────────────────────────────────────────────────────────
      const { output: build, response: buildRes } = await runBuilder(
        task, apiContract, designSpec, feedback, retryHistory
      )

      await dispatchNotification("afterBuild", { task, output: build, attempt })

      // ── Static validation ─────────────────────────────────────────────────
      spinner.text = `  [${task.agent.toUpperCase()}] ${task.title} — validating...`
      const staticResult = await runStaticValidation(task, build, apiContract, designSpec)

      if (!staticResult.passed) {
        spinner.fail(
          chalk.red(`  [${task.agent.toUpperCase()}] ${task.title} — static validation failed`)
        )

        const normalizedErrors = staticResult.errors.map((e) =>
          normalizeValidationError(e, "typecheck")
        )
        const normalizedWarnings = staticResult.warnings.map((w) =>
          normalizeValidationWarning(w, "typecheck")
        )

        for (const failure of normalizedErrors) {
          await dispatchNotification("onFailure", { task, failure })
          retryHistory.failures.push(failure)
        }

        const staticFeedback = normalizedErrors.map(
          (f) => `[${f.code}] ${f.message}${f.file ? ` (${f.file})` : ""}`
        )
        const warnFeedback = normalizedWarnings.map(
          (w) => `[WARNING] ${w.message}${w.file ? ` (${w.file})` : ""}`
        )

        console.log(chalk.red("    Static errors:"))
        staticFeedback.forEach((f) => console.log(chalk.dim(`      • ${f}`)))
        if (warnFeedback.length > 0) {
          console.log(chalk.yellow("    Warnings:"))
          warnFeedback.forEach((w) => console.log(chalk.dim(`      ⚠ ${w}`)))
        }

        await appendJournal({
          task_id: task.id, attempt, type: "validator_fail",
          content: `Static validation failed: ${staticFeedback.join("; ")}`,
          timestamp: new Date().toISOString(),
        })

        // beforeRetry mutation: Pi can augment feedback before next attempt
        if (attempt < MAX_RETRIES + 1 && normalizedErrors[0]) {
          const retryPayload = await dispatchMutation("beforeRetry", {
            failure: normalizedErrors[0],
            retryInput: { task, feedback: [...staticFeedback, ...warnFeedback], attempt },
          })
          feedback = retryPayload.retryInput.feedback
        } else {
          feedback = [...staticFeedback, ...warnFeedback]
        }

        await removeWorktree(worktreePath)
        continue
      }

      if (staticResult.warnings.length > 0) {
        staticResult.warnings.forEach((w) =>
          console.log(chalk.dim(`      ⚠ ${w.message}`))
        )
      }

      // ── Apply changes to the worktree ─────────────────────────────────────
      await applyChanges(build.changes, task.workspace, worktreePath)

      // ── Commit in worktree ────────────────────────────────────────────────
      const commitSha = await commitInWorktree(
        worktreePath,
        `[${task.agent}] ${task.title}${attempt > 1 ? ` (retry ${attempt - 1})` : ""}`
      )

      // ── beforeRuntime gate ────────────────────────────────────────────────
      const runtimeGate = await dispatchGate("beforeRuntime", { task, attempt })
      if (!runtimeGate.proceed) {
        spinner.fail(chalk.red(`  [${task.agent.toUpperCase()}] ${task.title} — runtime blocked: ${runtimeGate.reason}`))
        await removeWorktree(worktreePath)
        continue
      }

      // ── Sandbox execution (when configured) ───────────────────────────────
      if (config.sandbox) {
        spinner.text = `  [${task.agent.toUpperCase()}] ${task.title} — sandbox...`
        const artifact = await executeSandbox(worktreePath, `${task.id}-attempt-${attempt}`, config)

        await dispatchNotification("afterRuntime", { task, artifact })

        if (artifact.exitCode !== 0) {
          spinner.fail(
            chalk.red(`  [${task.agent.toUpperCase()}] ${task.title} — sandbox failed (exit ${artifact.exitCode})`)
          )

          const failure: NormalizedFailure = normalizeRuntimeError(
            artifact.stderr || artifact.stdout,
            "test",
            { code: "SANDBOX_FAILURE", severity: "hard" }
          )
          failure.artifactRefs = { logs: [`traces/${task.id}-attempt-${attempt}.log`] }
          retryHistory.failures.push(failure)

          await dispatchNotification("onFailure", { task, failure, artifact })

          await appendJournal({
            task_id: task.id, attempt, type: "validator_fail",
            content: `Sandbox failed (exit ${artifact.exitCode}): ${(artifact.stderr || artifact.stdout).slice(0, 200)}`,
            timestamp: new Date().toISOString(),
          })

          if (attempt < MAX_RETRIES + 1) {
            const retryPayload = await dispatchMutation("beforeRetry", {
              failure,
              retryInput: {
                task,
                feedback: [artifact.stderr || artifact.stdout].filter(Boolean),
                attempt,
              },
            })
            feedback = retryPayload.retryInput.feedback
          }

          await removeWorktree(worktreePath)
          continue
        }
      }

      // ── LLM Reviewer ─────────────────────────────────────────────────────
      spinner.text = `  [${task.agent.toUpperCase()}] ${task.title} — reviewing...`
      const diff = await getDiffFromWorktree(worktreePath)
      const { output: review, response: reviewRes } = await runReviewer(
        task, diff, apiContract, designSpec
      )

      const passedCount = review.criteria_results.filter((r) => r.passed).length
      const reviewPassRate = review.criteria_results.length > 0
        ? passedCount / review.criteria_results.length
        : 1

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
        // ── beforeCommit gate (confidence boundary) ───────────────────────
        const confidence = buildConfidence(attempt, reviewPassRate, staticResult.errors.length)
        const commitGate = await dispatchGate("beforeCommit", {
          task,
          build,
          registryDelta: build.registry_updates,
          confidence,
        })

        if (!commitGate.proceed) {
          // Confidence gate denied — route based on tier
          if (confidence.tier === "medium") {
            await updateTaskStatus(task.id, "awaiting_approval", attempt)
            spinner.warn(chalk.yellow(
              `  [${task.agent.toUpperCase()}] ${task.title} — awaiting approval (${commitGate.reason ?? "medium confidence"})`
            ))
          } else {
            await updateTaskStatus(task.id, "escalated", attempt)
            spinner.fail(chalk.red(
              `  [${task.agent.toUpperCase()}] ${task.title} — escalated (${commitGate.reason ?? "low confidence"})`
            ))
          }
          await removeWorktree(worktreePath)
          trace.status = "blocked"
          return trace
        }

        // ── Cherry-pick reviewed commit into main branch ───────────────────
        await cherryPickToMain(commitSha)

        // ── Apply registry updates ─────────────────────────────────────────
        await applyRegistryUpdates(build.registry_updates, task.id)

        await registerOwnership(build.registry_updates, task.id, task.agent, attempt)

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
          content: `All ${review.criteria_results.length} criteria passed. Confidence: ${confidence.tier} (${Math.round(confidence.score * 100)}%).`,
          files_affected: build.changes.map((c) => c.file),
          timestamp: new Date().toISOString(),
        })

        await updateTaskStatus(task.id, "pass", attempt)
        trace.status = "pass"
        spinner.succeed(chalk.green(`  [${task.agent.toUpperCase()}] ${task.title}`))

        await dispatchNotification("afterRetry", { task, attempt, succeeded: true })
        await removeWorktree(worktreePath)
        return trace
      }

      // ── Review failed ─────────────────────────────────────────────────────
      spinner.fail(
        chalk.yellow(`  [${task.agent.toUpperCase()}] ${task.title} — attempt ${attempt} failed`)
      )
      review.feedback.forEach((f) => console.log(chalk.dim(`      • ${f}`)))

      const reviewFailure: NormalizedFailure = normalizeRuntimeError(
        review.feedback.join("; "),
        "review",
        { code: "REVIEW_FAIL", severity: "soft" }
      )
      retryHistory.failures.push(reviewFailure)

      await appendJournal({
        task_id: task.id, attempt, type: "validator_fail",
        content: review.feedback.join("; "),
        files_affected: build.changes.map((c) => c.file),
        timestamp: new Date().toISOString(),
      })

      if (attempt < MAX_RETRIES + 1) {
        const retryPayload = await dispatchMutation("beforeRetry", {
          failure: reviewFailure,
          retryInput: { task, feedback: review.feedback, attempt },
        })
        feedback = retryPayload.retryInput.feedback
        await markTaskStale(task.id)
      } else {
        feedback = review.feedback
      }

      await dispatchNotification("afterRetry", { task, attempt, succeeded: false })
      await removeWorktree(worktreePath)

    } catch (err) {
      spinner.fail(chalk.red(`  [${task.agent.toUpperCase()}] ${task.title} — error`))
      console.error(chalk.red(`    ${err}`))
      feedback = [`Runtime error on attempt ${attempt}: ${err}`]
      await removeWorktree(worktreePath).catch(() => {})
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
