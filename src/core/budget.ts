import fs from "fs-extra"
import path from "path"
import chalk from "chalk"
import { loadConfig } from "./config.js"

// ─── Types ────────────────────────────────────────────────────────────────────

export type BudgetThreshold = {
  percent: number
  label: string
  color: (s: string) => string
  notified: boolean
}

export type MonthlySpend = {
  month: string              // "YYYY-MM"
  total_cost_usd: number
  total_input_tokens: number
  total_output_tokens: number
  run_count: number
  last_updated: string
}

export type BudgetState = {
  monthly_limit_usd: number
  spend: MonthlySpend[]      // one entry per month, last 12 kept
  thresholds_notified: number[] // which % thresholds already fired this month
}

// ─── Constants ────────────────────────────────────────────────────────────────

export const THRESHOLDS: BudgetThreshold[] = [
  { percent: 50, label: "50%",  color: chalk.yellow,      notified: false },
  { percent: 75, label: "75%",  color: chalk.yellow,      notified: false },
  { percent: 90, label: "90%",  color: chalk.red,         notified: false },
  { percent: 95, label: "95%",  color: chalk.bold.red,    notified: false },
  { percent: 100, label: "100%", color: chalk.bgRed.white, notified: false },
]

const DEFAULT_MONTHLY_LIMIT = 20.00  // USD

// ─── Path ────────────────────────────────────────────────────────────────────

async function getBudgetPath(): Promise<string> {
  const config = await loadConfig()
  return path.join(config.projectRoot, ".agent", "budget.json")
}

// ─── Init / load ─────────────────────────────────────────────────────────────

async function loadBudgetState(): Promise<BudgetState> {
  const budgetPath = await getBudgetPath()

  if (!(await fs.pathExists(budgetPath))) {
    const config = await loadConfig()
    const initial: BudgetState = {
      monthly_limit_usd: (config as any).monthlyBudgetUsd ?? DEFAULT_MONTHLY_LIMIT,
      spend: [],
      thresholds_notified: [],
    }
    await fs.ensureDir(path.dirname(budgetPath))
    await fs.writeJSON(budgetPath, initial, { spaces: 2 })
    return initial
  }

  return fs.readJSON(budgetPath) as Promise<BudgetState>
}

async function saveBudgetState(state: BudgetState): Promise<void> {
  const budgetPath = await getBudgetPath()
  await fs.writeJSON(budgetPath, state, { spaces: 2 })
}

// ─── Current month entry ──────────────────────────────────────────────────────

function currentMonth(): string {
  return new Date().toISOString().slice(0, 7)  // "YYYY-MM"
}

function getOrCreateMonthEntry(state: BudgetState): MonthlySpend {
  const month = currentMonth()
  let entry = state.spend.find((s) => s.month === month)

  if (!entry) {
    entry = {
      month,
      total_cost_usd: 0,
      total_input_tokens: 0,
      total_output_tokens: 0,
      run_count: 0,
      last_updated: new Date().toISOString(),
    }
    state.spend.push(entry)

    // Reset threshold notifications for new month
    state.thresholds_notified = []

    // Keep only last 12 months
    state.spend = state.spend
      .sort((a, b) => a.month.localeCompare(b.month))
      .slice(-12)
  }

  return entry
}

// ─── Record spend ─────────────────────────────────────────────────────────────

export async function recordSpend(
  costUsd: number,
  inputTokens: number,
  outputTokens: number
): Promise<void> {
  const state = await loadBudgetState()
  const entry = getOrCreateMonthEntry(state)

  entry.total_cost_usd += costUsd
  entry.total_input_tokens += inputTokens
  entry.total_output_tokens += outputTokens
  entry.last_updated = new Date().toISOString()

  await saveBudgetState(state)

  // Check thresholds after recording
  await checkThresholds(state, entry)
}

// ─── Record run ───────────────────────────────────────────────────────────────

export async function recordRunComplete(totalCostUsd: number): Promise<void> {
  const state = await loadBudgetState()
  const entry = getOrCreateMonthEntry(state)
  entry.run_count++
  await saveBudgetState(state)
}

// ─── Threshold checking ───────────────────────────────────────────────────────

async function checkThresholds(
  state: BudgetState,
  entry: MonthlySpend
): Promise<void> {
  const percent = (entry.total_cost_usd / state.monthly_limit_usd) * 100

  for (const threshold of THRESHOLDS) {
    if (
      percent >= threshold.percent &&
      !state.thresholds_notified.includes(threshold.percent)
    ) {
      state.thresholds_notified.push(threshold.percent)
      printThresholdWarning(threshold, entry, state.monthly_limit_usd, percent)
    }
  }

  await saveBudgetState(state)
}

function printThresholdWarning(
  threshold: BudgetThreshold,
  entry: MonthlySpend,
  limit: number,
  currentPercent: number
): void {
  const spent    = entry.total_cost_usd.toFixed(4)
  const limitStr = limit.toFixed(2)
  const remaining = Math.max(0, limit - entry.total_cost_usd).toFixed(4)

  console.log()
  console.log(threshold.color(
    `  ⚠ Budget ${threshold.label} reached — $${spent} of $${limitStr}/mo used`
  ))

  if (threshold.percent >= 100) {
    console.log(chalk.bgRed.white("  🛑 Monthly budget exhausted. Halting run."))
    console.log(chalk.dim(`  To continue: increase monthlyBudgetUsd in .agent/config.json`))
    console.log(chalk.dim(`  Current limit: $${limitStr}/mo`))
  } else if (threshold.percent >= 90) {
    console.log(chalk.red(`  Remaining budget: $${remaining}`))
    console.log(chalk.dim(`  Consider pausing — increase limit in .agent/config.json`))
  } else {
    console.log(chalk.dim(`  Remaining: $${remaining} of $${limitStr}/mo`))
  }
  console.log()
}

// ─── Pre-run budget check ─────────────────────────────────────────────────────

/**
 * Call before starting a run. Returns false if budget is exhausted.
 * Prints current spend status.
 */
export async function checkBudgetBeforeRun(): Promise<boolean> {
  const state = await loadBudgetState()
  const entry = getOrCreateMonthEntry(state)

  const percent = (entry.total_cost_usd / state.monthly_limit_usd) * 100
  const remaining = Math.max(0, state.monthly_limit_usd - entry.total_cost_usd)

  if (entry.total_cost_usd > 0) {
    console.log(chalk.dim(
      `  Budget: $${entry.total_cost_usd.toFixed(4)} / $${state.monthly_limit_usd.toFixed(2)} ` +
      `(${percent.toFixed(1)}% — $${remaining.toFixed(4)} remaining this month)`
    ))
  }

  if (percent >= 100) {
    console.log(chalk.bgRed.white("\n  🛑 Monthly budget exhausted — cannot start run"))
    console.log(chalk.dim(`  Spent: $${entry.total_cost_usd.toFixed(4)} of $${state.monthly_limit_usd.toFixed(2)}/mo`))
    console.log(chalk.dim(`  To continue: increase monthlyBudgetUsd in .agent/config.json\n`))
    return false
  }

  return true
}

/**
 * Call after every model call to check if budget was just exceeded mid-run.
 * Returns true if the run should halt.
 */
export async function isBudgetExhausted(): Promise<boolean> {
  const state = await loadBudgetState()
  const entry = getOrCreateMonthEntry(state)
  return entry.total_cost_usd >= state.monthly_limit_usd
}

// ─── Status display ───────────────────────────────────────────────────────────

export async function printBudgetStatus(): Promise<void> {
  const state = await loadBudgetState()
  const month = currentMonth()

  console.log(chalk.bold("\n  Monthly Budget\n"))
  console.log(chalk.dim(`  Limit: $${state.monthly_limit_usd.toFixed(2)}/mo`))
  console.log(chalk.dim(`  Config: .agent/config.json → monthlyBudgetUsd\n`))

  const sorted = [...state.spend].sort((a, b) => b.month.localeCompare(a.month))

  for (const entry of sorted) {
    const percent = (entry.total_cost_usd / state.monthly_limit_usd) * 100
    const bar = buildBar(percent)
    const isCurrent = entry.month === month
    const label = isCurrent ? chalk.bold(entry.month + " (current)") : chalk.dim(entry.month)

    console.log(`  ${label}`)
    console.log(
      `  ${bar} ${chalk.bold("$" + entry.total_cost_usd.toFixed(4))} ` +
      chalk.dim(`(${percent.toFixed(1)}% — ${entry.run_count} run${entry.run_count !== 1 ? "s" : ""})`)
    )
    console.log(
      chalk.dim(`  Tokens: ${entry.total_input_tokens.toLocaleString()} in / ${entry.total_output_tokens.toLocaleString()} out\n`)
    )
  }

  if (sorted.length === 0) {
    console.log(chalk.dim("  No spend recorded yet.\n"))
  }
}

function buildBar(percent: number, width: number = 20): string {
  const filled = Math.min(Math.round((percent / 100) * width), width)
  const empty  = width - filled
  const bar    = "█".repeat(filled) + "░".repeat(empty)
  const color  = percent >= 100 ? chalk.red : percent >= 75 ? chalk.yellow : chalk.green
  return color(bar)
}
