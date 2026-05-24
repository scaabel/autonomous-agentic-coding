#!/usr/bin/env node
import "dotenv/config"
import { Command } from "commander"
import chalk from "chalk"
import fs from "fs-extra"
import { run } from "../orchestrator/run.js"
import { getRegistryPaths } from "../core/registry.js"
import { readOwnershipIndex } from "../core/kernel/ownership.js"
import { init } from "./init.js"
import { printBudgetStatus } from "../core/budget.js"
import { writeConfig } from "../core/config.js"
import { appendJournal, updateTaskStatus } from "../core/registry.js"
import { getAllWorkspaces, isMonorepo } from "../core/workspace.js"
import type { Task, TaskQueue } from "../core/types.js"

const program = new Command()

program
  .name("agent")
  .description("Multi-agent AI development system for solo developers")
  .version("0.3.0")

// ─── agent init ───────────────────────────────────────────────────────────────
program
  .command("init")
  .description("Initialise agent-system in a new or existing project")
  .option("--scan-existing", "Pre-populate registry from existing components and hooks", false)
  .option("-y, --yes", "Skip confirmation prompts", false)
  .action(async (options) => {
    try {
      await init({ scanExisting: options.scanExisting, yes: options.yes })
    } catch (err) {
      console.error(chalk.red(`\n❌ Init failed: ${err}\n`))
      process.exit(1)
    }
  })

// ─── agent run ────────────────────────────────────────────────────────────────
program
  .command("run")
  .description("Run the full agent loop: plan → design → build → validate → review → test")
  .argument("<task>", 'What to build (e.g. "add user authentication")')
  .option("-i, --interactive", "Pause for human approval after planning", true)
  .option("--no-interactive", "Skip human approval step")
  .option("--docs-dir <dir>", "Directory for docs/contracts/registry", "docs")
  .option("--mockups-dir <dir>", "Directory for task mockup images ([task-id].png)", ".agent/mockups")
  .action(async (task: string, options) => {
    if (!process.env.ANTHROPIC_API_KEY) {
      console.error(chalk.red("❌ ANTHROPIC_API_KEY not set. Add it to .env"))
      process.exit(1)
    }
    try {
      await run(task, {
        interactive: options.interactive,
        docsDir: options.docsDir,
        mockupsDir: options.mockupsDir,
      })
    } catch (err) {
      console.error(chalk.red(`\n❌ Run failed: ${err}\n`))
      process.exit(1)
    }
  })

// ─── agent status ─────────────────────────────────────────────────────────────
program
  .command("status")
  .description("Show current task queue and ownership summary")
  .action(async () => {
    try {
      const p = await getRegistryPaths()
      const queue = await fs.readJSON(p.taskQueue) as TaskQueue
      console.log(chalk.bold("\nTask Queue\n"))

      for (const task of queue.tasks as Task[]) {
        const icon =
          task.status === "pass"               ? chalk.green("✓") :
          task.status === "manually_completed" ? chalk.cyan("✓M") :
          task.status === "blocked"            ? chalk.red("✗") :
          task.status === "in_progress"        ? chalk.yellow("→") :
                                                  chalk.dim("○")
        const retries = task.attempts > 1 ? chalk.dim(` (${task.attempts} attempts)`) : ""
        const manual  = task.status === "manually_completed" ? chalk.dim(" [manual]") : ""
        console.log(`  ${icon}  ${chalk.dim(task.id)}  ${task.title}${retries}${manual}`)
      }

      // Inline budget summary
      const { printBudgetStatus: _unused, ..._ } = await import("../core/budget.js")
      const budgetMod = await import("../core/budget.js")
      await budgetMod.printBudgetStatus()

      // Show ownership summary if available
      try {
        const index = await readOwnershipIndex()
        const fileCount = Object.keys(index.files).length
        const staleCount = Object.values(index.files).filter((f) => f.stale).length
        const mutationCount = index.mutation_log.length

        console.log(chalk.bold("\nOwnership Index\n"))
        console.log(chalk.dim(`  Files tracked:   ${fileCount}`))
        console.log(chalk.dim(`  Stale files:     ${staleCount}`))
        console.log(chalk.dim(`  Mutations:       ${mutationCount}`))
        console.log(chalk.dim(`  Dependencies:    ${index.dependencies.length} edges`))

        if (staleCount > 0) {
          console.log(chalk.yellow("\n  ⚠ Stale files detected — some tasks may have stale context"))
        }
      } catch {
        // ownership index not yet initialised
      }

      console.log()
    } catch {
      console.log(chalk.yellow("No active run found. Use `agent run <task>` to start.\n"))
    }
  })

// ─── agent journal ─────────────────────────────────────────────────────────────
program
  .command("journal")
  .description("Show run journal (decisions and corrections)")
  .option("-n, --last <n>", "Show last N entries", "10")
  .option("--task <id>", "Filter by task ID")
  .option("--type <type>", "Filter by type: decision | correction | validator_pass | validator_fail")
  .action(async (options) => {
    try {
      const p = await getRegistryPaths()
      const journal = await fs.readJSON(p.journal)
      let entries = journal.entries

      if (options.task) {
        entries = entries.filter((e: any) => e.task_id === options.task)
      }
      if (options.type) {
        entries = entries.filter((e: any) => e.type === options.type)
      }

      entries = entries.slice(-parseInt(options.last))
      console.log(chalk.bold(`\nRun Journal (${entries.length} entries)\n`))

      for (const e of entries) {
        const color =
          e.type === "validator_pass" ? chalk.green :
          e.type === "validator_fail" ? chalk.red :
          e.type === "correction"     ? chalk.yellow :
                                        chalk.cyan
        console.log(
          color(`  [${e.task_id} / ${e.type}]`) +
          chalk.dim(` ${e.timestamp.slice(11, 19)}`)
        )
        console.log(`    ${e.content}`)
        if (e.files_affected?.length) {
          console.log(chalk.dim(`    Files: ${e.files_affected.join(", ")}`))
        }
        console.log()
      }
    } catch {
      console.log(chalk.yellow("No journal found. Use `agent run <task>` to start.\n"))
    }
  })

// ─── agent ownership ──────────────────────────────────────────────────────────
program
  .command("ownership")
  .description("Show file ownership graph")
  .option("--task <id>", "Show files owned by a specific task")
  .option("--stale", "Show only stale files")
  .action(async (options) => {
    try {
      const index = await readOwnershipIndex()
      console.log(chalk.bold("\nOwnership Index\n"))

      let files = Object.values(index.files)
      if (options.task) files = files.filter((f) => f.owned_by === options.task)
      if (options.stale) files = files.filter((f) => f.stale)

      for (const f of files) {
        const staleTag = f.stale ? chalk.yellow(" [STALE]") : ""
        const consumerTag = f.consumers.length > 0
          ? chalk.dim(` → consumed by: ${f.consumers.join(", ")}`)
          : ""
        console.log(
          `  ${chalk.dim(f.owned_by)}  ${f.path}${staleTag}${consumerTag}`
        )
      }

      if (index.dependencies.length > 0) {
        console.log(chalk.bold("\nDependency Graph\n"))
        for (const edge of index.dependencies) {
          const staleTag = edge.stale ? chalk.yellow(" [STALE]") : ""
          console.log(
            `  ${chalk.cyan(edge.from)} → ${chalk.dim(edge.to)}${staleTag}`
          )
          if (edge.via.length > 0) {
            console.log(chalk.dim(`    via: ${edge.via.join(", ")}`))
          }
        }
      }

      console.log()
    } catch {
      console.log(chalk.yellow("No ownership index found. Run `agent run` first.\n"))
    }
  })

// ─── agent validate ───────────────────────────────────────────────────────────
program
  .command("validate")
  .description("Run static validation on a file without a full agent run")
  .argument("<file>", "File path to validate")
  .action(async (file: string) => {
    try {
      const content = await fs.readFile(file, "utf-8")
      console.log(chalk.bold(`\nStatic Validation: ${file}\n`))

      // Run lightweight subset of AST checks directly
      const errors: string[] = []
      const warnings: string[] = []

      const isComponent = file.endsWith(".tsx")
      const isTest = file.includes("tests/e2e/")

      if (isComponent) {
        if (content.includes("style={{"))
          errors.push("[AST_INLINE_STYLE] Inline styles detected — use Tailwind")
        const hexMatches = content.match(/#[0-9a-fA-F]{3,6}(?![0-9a-fA-F])/g)
        if (hexMatches)
          errors.push(`[AST_RAW_HEX] Raw hex values: ${hexMatches.slice(0, 3).join(", ")}`)
        const buttonCount = (content.match(/<Button|<button/g) ?? []).length
        const testidCount = (content.match(/data-testid=/g) ?? []).length
        if (buttonCount > 0 && testidCount === 0)
          errors.push("[AST_MISSING_TESTID] Buttons/inputs present but no data-testid attributes")
        if (content.includes(": any"))
          warnings.push("[AST_IMPLICIT_ANY] any type used — prefer specific types")
      }

      if (isTest) {
        if (content.includes(".locator('.") || content.includes('.locator(".'))
          errors.push("[AST_CSS_SELECTOR] CSS class selectors in test — use getByTestId()")
        if (content.includes("createTestUser") && !content.includes("afterEach"))
          errors.push("[AST_MISSING_CLEANUP] Test creates data but has no afterEach cleanup")
      }

      if (errors.length === 0 && warnings.length === 0) {
        console.log(chalk.green("  ✓ No issues found\n"))
      } else {
        errors.forEach((e) => console.log(chalk.red(`  ✗ ${e}`)))
        warnings.forEach((w) => console.log(chalk.yellow(`  ⚠ ${w}`)))
        console.log()
      }
    } catch (err) {
      console.error(chalk.red(`Cannot read file: ${err}\n`))
    }
  })

// ─── agent budget ─────────────────────────────────────────────────────────────
program
  .command("budget")
  .description("Show monthly spend, budget usage, and threshold history")
  .option("--set <amount>", "Set monthly budget limit in USD (e.g. --set 30)")
  .action(async (options) => {
    if (options.set) {
      const amount = parseFloat(options.set)
      if (isNaN(amount) || amount <= 0) {
        console.error(chalk.red("  Invalid amount. Example: agent budget --set 30\n"))
        process.exit(1)
      }
      await writeConfig({ monthlyBudgetUsd: amount })
      console.log(chalk.green(`  ✓ Monthly budget set to $${amount.toFixed(2)}\n`))
    }
    await printBudgetStatus()
  })

// ─── agent complete ───────────────────────────────────────────────────────────
program
  .command("complete")
  .description("Mark a blocked task as manually completed so the run can continue")
  .argument("<task-id>", "Task ID to mark complete (e.g. fe-001)")
  .option("--note <note>", "Optional note about what you did manually")
  .action(async (taskId: string, options) => {
    try {
      const p = await getRegistryPaths()
      const queue = await fs.readJSON(p.taskQueue) as TaskQueue
      const task = queue.tasks.find((t: Task) => t.id === taskId)

      if (!task) {
        console.error(chalk.red(`  Task ${taskId} not found in current task queue\n`))
        console.log(chalk.dim("  Run `agent status` to see available task IDs\n"))
        process.exit(1)
      }

      if (task.status === "pass") {
        console.log(chalk.yellow(`  Task ${taskId} is already complete (passed agent review)\n`))
        return
      }

      if (task.status === "manually_completed") {
        console.log(chalk.yellow(`  Task ${taskId} is already marked as manually completed\n`))
        return
      }

      // Mark as manually_completed in the task queue
      await updateTaskStatus(taskId, "manually_completed", task.attempts)

      // Append to journal so agents know this was manual
      const note = options.note ?? "Completed manually by developer"
      await appendJournal({
        task_id: taskId,
        attempt: task.attempts,
        type: "decision",
        content: `MANUALLY COMPLETED: ${note}. Agent skipped this task — read any files this task was supposed to create before assuming they exist.`,
        timestamp: new Date().toISOString(),
      })

      console.log(chalk.green(`  ✓ Task ${taskId} marked as manually completed\n`))
      console.log(chalk.dim(`  "${task.title}"`))
      if (options.note) {
        console.log(chalk.dim(`  Note: ${options.note}`))
      }
      console.log()
      console.log(chalk.bold("  Next steps:"))
      console.log(chalk.dim("  1. Commit any files you created/modified for this task"))
      console.log(chalk.dim("     git add . && git commit -m \"[manual] " + task.title + "\""))
      console.log(chalk.dim("  2. Run `agent resume` to continue from the next task\n"))

    } catch (err) {
      console.error(chalk.red(`  Failed: ${err}\n`))
      process.exit(1)
    }
  })

// ─── agent resume ─────────────────────────────────────────────────────────────
program
  .command("resume")
  .description("Resume a run from the last incomplete task")
  .option("--no-interactive", "Skip human approval prompts")
  .action(async (options) => {
    try {
      const p = await getRegistryPaths()

      // Check task queue exists
      if (!(await fs.pathExists(p.taskQueue))) {
        console.log(chalk.yellow("  No active run found. Use `agent run <task>` to start.\n"))
        return
      }

      const queue = await fs.readJSON(p.taskQueue) as TaskQueue

      const pending = queue.tasks.filter(
        (t: Task) => t.status !== "pass" && t.status !== "manually_completed"
      )

      if (pending.length === 0) {
        console.log(chalk.green("  All tasks are already complete — nothing to resume.\n"))
        return
      }

      const blocked = queue.tasks.filter((t: Task) => t.status === "blocked")
      if (blocked.length > 0) {
        console.log(chalk.bold.yellow("\n  Blocked tasks:\n"))
        blocked.forEach((t: Task) => {
          console.log(`  ${chalk.red("✗")}  ${chalk.dim(t.id)}  ${t.title}`)
          console.log(chalk.dim(`     Mark complete: agent complete ${t.id} --note "what you did"\n`))
        })
      }

      console.log(chalk.bold(`\n  Resuming — ${pending.length} task(s) remaining\n`))

      // Re-run with the existing task queue (orchestrator skips completed tasks)
      await run(queue.feature, {
        interactive: options.interactive,
      })

    } catch (err) {
      console.error(chalk.red(`  Resume failed: ${err}\n`))
      process.exit(1)
    }
  })

// ─── agent workspaces ─────────────────────────────────────────────────────────
program
  .command("workspaces")
  .description("List configured workspaces and their agent assignments")
  .action(async () => {
    try {
      const mono = await isMonorepo()
      if (!mono) {
        console.log(chalk.dim("\n  Single-project mode — no workspaces configured."))
        console.log(chalk.dim("  Run `agent init` in a monorepo to auto-detect workspaces.\n"))
        return
      }

      const workspaces = await getAllWorkspaces()
      console.log(chalk.bold("\n  Workspaces\n"))

      for (const ws of workspaces) {
        console.log(`  ${chalk.cyan(ws.name.padEnd(14))} ${chalk.dim(ws.root)}`)
        console.log(`  ${" ".repeat(14)} ${ws.framework} | ${ws.language} | agents: ${ws.agents.join(", ")}`)
        console.log(`  ${" ".repeat(14)} skills: ${ws.absoluteSkillsDir.replace(process.cwd() + "/", "")}`)
        console.log(`  ${" ".repeat(14)} tests:  ${ws.absoluteTestDir.replace(process.cwd() + "/", "")}`)
        console.log()
      }

      console.log(chalk.dim("  Edit .agent/config.json to add or modify workspaces.\n"))
    } catch (err) {
      console.error(chalk.red(`  Failed: ${err}\n`))
    }
  })

program.parse()
