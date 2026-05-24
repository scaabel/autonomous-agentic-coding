import fs from "fs-extra"
import path from "path"
import { fileURLToPath } from "url"
import type { WorkspaceDefinition } from "./workspace.js"

// ─── Types ────────────────────────────────────────────────────────────────────

export type AgentConfig = {
  // Models
  model: string
  fastModel: string

  // Behaviour
  maxRetries: number
  requireApproval: boolean
  monthlyBudgetUsd: number

  // Single-project structure (used when workspaces is absent)
  framework: string
  language: string
  srcDir: string
  docsDir: string
  tracesDir: string
  skillsDir: string
  mockupsDir: string
  testDir: string

  // Monorepo workspaces (optional — absence = single-project mode)
  workspaces?: Record<string, WorkspaceDefinition>

  // Resolved at runtime
  projectRoot: string
  packageRoot: string
}

// ─── Defaults ─────────────────────────────────────────────────────────────────

export const CONFIG_DEFAULTS: Omit<AgentConfig, "projectRoot" | "packageRoot"> = {
  model:             "claude-sonnet-4-6",
  fastModel:         "claude-haiku-4-5-20251001",
  maxRetries:        2,
  requireApproval:   true,
  monthlyBudgetUsd:  20.00,
  framework:       "generic",
  language:        "ts",
  srcDir:          "src",
  docsDir:         "docs",
  tracesDir:       ".agent/traces",
  skillsDir:       ".agent/skills",
  mockupsDir:      ".agent/mockups",
  testDir:         "tests/e2e",
}

// ─── Config file path ─────────────────────────────────────────────────────────

export const CONFIG_PATH = path.join(process.cwd(), ".agent", "config.json")

// ─── Package root (where templates/ and default skills/ live) ─────────────────

function resolvePackageRoot(): string {
  // Works both when running from source (tsx) and from dist (node)
  const currentFile = fileURLToPath(import.meta.url)
  // src/core/config.ts → up 2 levels to package root
  return path.resolve(path.dirname(currentFile), "..", "..")
}

// ─── Load ─────────────────────────────────────────────────────────────────────

let _config: AgentConfig | null = null

export async function loadConfig(): Promise<AgentConfig> {
  if (_config) return _config

  const projectRoot = process.cwd()
  const packageRoot = resolvePackageRoot()

  // Start with defaults
  const base = { ...CONFIG_DEFAULTS }

  // Layer 1: .agent/config.json (user's project config)
  if (await fs.pathExists(CONFIG_PATH)) {
    try {
      const fromFile = await fs.readJSON(CONFIG_PATH)
      Object.assign(base, fromFile)
    } catch (err) {
      console.warn(`Warning: could not parse .agent/config.json — using defaults (${err})`)
    }
  }

  // Layer 2: environment variable overrides (highest priority for secrets + CI)
  if (process.env.AGENT_MODEL)   base.model = process.env.AGENT_MODEL
  if (process.env.FAST_MODEL)    base.fastModel = process.env.FAST_MODEL
  if (process.env.MAX_RETRIES)   base.maxRetries = parseInt(process.env.MAX_RETRIES, 10)
  if (process.env.REQUIRE_PRD_APPROVAL === "false") base.requireApproval = false

  _config = { ...base, projectRoot, packageRoot }
  return _config
}

export function resetConfig(): void {
  _config = null
}

// ─── Write a new config to disk ───────────────────────────────────────────────

export async function writeConfig(
  partial: Partial<Omit<AgentConfig, "projectRoot" | "packageRoot">>
): Promise<void> {
  await fs.ensureDir(path.dirname(CONFIG_PATH))

  let existing: Record<string, unknown> = {}
  if (await fs.pathExists(CONFIG_PATH)) {
    existing = await fs.readJSON(CONFIG_PATH)
  }

  await fs.writeJSON(CONFIG_PATH, { ...existing, ...partial }, { spaces: 2 })
  resetConfig()
}

// ─── Type guard ───────────────────────────────────────────────────────────────

export function isInitialised(): Promise<boolean> {
  return fs.pathExists(CONFIG_PATH)
}
