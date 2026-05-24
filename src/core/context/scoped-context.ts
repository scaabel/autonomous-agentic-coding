import fs from "fs-extra"
import path from "path"
import type {
  Task, RunJournal, JournalEntry,
  SharedTypesRegistry, SharedTypeEntry,
  BeRegistry, FeRegistry, ComponentsRegistry,
  ComponentEntry, HooksRegistry, HookEntry, RegistryFileEntry,
} from "../types.js"
import type { ScopedContext } from "./types.js"
import { readOwnershipIndex, getDependencyChain } from "../kernel/ownership.js"
import { getRegistryPaths } from "../registry.js"
import { resolveWorkspace, isMonorepo } from "../workspace.js"
import { loadConfig } from "../config.js"

const TOKEN_BUDGETS: Record<string, number> = {
  be: 4000, fe: 6000, designer: 2000, reviewer: 3000,
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

// ─── Main entry ───────────────────────────────────────────────────────────────

export async function buildScopedContext(task: Task): Promise<ScopedContext> {
  const budget = TOKEN_BUDGETS[task.agent] ?? 5000
  const p = await getRegistryPaths()
  let usedTokens = 0

  // Track content by semantic bucket for structured output + Pi compression
  const buckets = {
    sharedTypes: [] as string[],
    ownedFiles:  [] as string[],
    journalSlice: [] as string[],
    fileContents: [] as string[],
  }

  // Resolve workspace root for file loading
  let workspaceRoot: string | undefined
  if (task.workspace && await isMonorepo()) {
    const ws = await resolveWorkspace(task.workspace)
    workspaceRoot = ws.absoluteRoot
  }

  function tryAdd(text: string, bucket: keyof typeof buckets): boolean {
    const cost = estimateTokens(text)
    if (usedTokens + cost > budget) return false
    buckets[bucket].push(text)
    usedTokens += cost
    return true
  }

  // 1. Workspace context header (monorepo only)
  if (task.workspace) {
    const wsHeader = await buildWorkspaceHeader(task.workspace)
    if (wsHeader) tryAdd(wsHeader, "ownedFiles")
  }

  // 2. Shared types (always highest priority)
  const s1 = await buildSharedTypesSection(p)
  if (s1) tryAdd(s1, "sharedTypes")

  // 3. Dependency-aware context
  const s2 = await buildDependencySection(task)
  if (s2) tryAdd(s2, "ownedFiles")

  // 4. Agent-role context
  if (task.agent === "be") {
    const s3 = await buildBeSection(task, p)
    if (s3) tryAdd(s3, "ownedFiles")
  }
  if (task.agent === "fe") {
    const s4 = await buildFeSection(task, p)
    if (s4) tryAdd(s4, "ownedFiles")
  }

  // 5. Journal entries
  const s5 = await buildJournalSection(task, p)
  if (s5) tryAdd(s5, "journalSlice")

  // 6. Actual file contents (relative to workspace root)
  for (const filePath of task.scope.files_to_read) {
    const s6 = await buildFileSection(filePath, workspaceRoot, budget - usedTokens)
    if (s6) { if (!tryAdd(s6, "fileContents")) break }
  }

  const sections = {
    sharedTypes:  buckets.sharedTypes.join("\n\n"),
    ownedFiles:   buckets.ownedFiles.join("\n\n"),
    journalSlice: buckets.journalSlice.join("\n\n"),
    fileContents: buckets.fileContents.join("\n\n"),
  }

  const text = [
    sections.sharedTypes,
    sections.ownedFiles,
    sections.journalSlice,
    sections.fileContents,
  ].filter(Boolean).join("\n\n")

  return { text, tokenCount: usedTokens, sections }
}

// ─── Section builders ─────────────────────────────────────────────────────────

async function buildWorkspaceHeader(workspaceName: string): Promise<string | null> {
  try {
    const ws = await resolveWorkspace(workspaceName)
    return (
      `## Workspace: ${ws.name}\n` +
      `Framework: ${ws.framework} | Language: ${ws.language}\n` +
      `Root: ${ws.root} | Src: ${ws.srcDir}/\n` +
      `All file paths in your task are relative to this workspace root.`
    )
  } catch { return null }
}

async function buildSharedTypesSection(
  p: Awaited<ReturnType<typeof getRegistryPaths>>
): Promise<string | null> {
  try {
    const reg = await fs.readJSON(p.sharedTypes) as SharedTypesRegistry
    if (reg.types.length === 0) return null
    const lines = reg.types.map(
      (t: SharedTypeEntry) =>
        `- \`${t.name}\` → import from \`${t.defined_in}\` (export: \`${t.export}\`)`
    )
    return "## Shared Types (import — do NOT redefine)\n" + lines.join("\n")
  } catch { return null }
}

async function buildDependencySection(task: Task): Promise<string | null> {
  try {
    const index = await readOwnershipIndex()
    const depChain = await getDependencyChain(task.id)
    if (depChain.length === 0) return null

    const lines: string[] = []
    const seenStale: string[] = []

    for (const depTaskId of depChain) {
      const relevantFiles = Object.values(index.files).filter(
        (f) => f.owned_by === depTaskId && task.scope.files_to_read.includes(f.path)
      )
      for (const f of relevantFiles) {
        const staleTag = f.stale ? " ⚠️ STALE — dep was retried" : ""
        const wsTag = f.workspace ? ` [${f.workspace}]` : ""
        lines.push(`- \`${f.path}\`${wsTag} (from ${depTaskId})${staleTag}`)
        if (f.stale) seenStale.push(depTaskId)
      }
    }

    if (lines.length === 0) return null
    let section = "## Files from Dependencies\n" + lines.join("\n")
    if (seenStale.length > 0) {
      section += `\n\n⚠️ Tasks ${[...new Set(seenStale)].join(", ")} were retried — re-read their files carefully.`
    }
    return section
  } catch { return null }
}

async function buildBeSection(
  task: Task,
  p: Awaited<ReturnType<typeof getRegistryPaths>>
): Promise<string | null> {
  try {
    const reg = await fs.readJSON(p.be) as BeRegistry
    // In monorepo, show only files from same workspace
    const relevant = reg.files.filter(
      (f: RegistryFileEntry) =>
        f.task_id !== task.id &&
        (!task.workspace || !f.workspace || f.workspace === task.workspace)
    )
    if (relevant.length === 0) return null
    const lines = relevant.map(
      (f: RegistryFileEntry) => `- \`${f.path}\` — exports: ${f.exports.join(", ")}`
    )
    return "## BE Files Already Created\n" + lines.join("\n")
  } catch { return null }
}

async function buildFeSection(
  task: Task,
  p: Awaited<ReturnType<typeof getRegistryPaths>>
): Promise<string | null> {
  const sections: string[] = []

  try {
    // BE paths this FE task must not touch — cross-workspace awareness
    const beReg = await fs.readJSON(p.be) as BeRegistry
    const beFilesOffLimits = beReg.files.filter((f: RegistryFileEntry) => {
      if (task.workspace && f.workspace && f.workspace !== task.workspace) return false
      return true
    })
    if (beFilesOffLimits.length > 0) {
      sections.push("## BE-Owned Files (DO NOT create or modify)\n" +
        beFilesOffLimits.map((f: RegistryFileEntry) => `- \`${f.path}\``).join("\n"))
    }

    const feReg = await fs.readJSON(p.fe) as FeRegistry
    const others = feReg.files.filter(
      (f: RegistryFileEntry) =>
        f.task_id !== task.id &&
        (!task.workspace || !f.workspace || f.workspace === task.workspace)
    )
    if (others.length > 0) {
      sections.push("## FE Files Already Created\n" +
        others.map((f: RegistryFileEntry) => `- \`${f.path}\` — exports: ${f.exports.join(", ")}`).join("\n"))
    }

    const comps = await fs.readJSON(p.components) as ComponentsRegistry
    const relevantComps = comps.components.filter(
      (c: ComponentEntry) =>
        !task.workspace || !c.task_id || true  // components visible across same workspace
    )
    if (relevantComps.length > 0) {
      sections.push("## Existing Components (reuse before creating)\n" +
        relevantComps.map((c: ComponentEntry) => `- \`${c.name}\` → \`${c.path}\``).join("\n"))
    }

    const hooks = await fs.readJSON(p.hooks) as HooksRegistry
    if (hooks.hooks.length > 0) {
      sections.push("## Existing Hooks (reuse before creating)\n" +
        hooks.hooks.map((h: HookEntry) => `- \`${h.name}\` → \`${h.path}\``).join("\n"))
    }
  } catch { /* registries not yet populated */ }

  return sections.length > 0 ? sections.join("\n\n") : null
}

async function buildJournalSection(
  task: Task,
  p: Awaited<ReturnType<typeof getRegistryPaths>>
): Promise<string | null> {
  try {
    const journal = await fs.readJSON(p.journal) as RunJournal
    if (journal.entries.length === 0) return null

    const depChain = await getDependencyChain(task.id)
    const allFiles = [
      ...task.scope.files_to_create,
      ...task.scope.files_to_modify,
      ...task.scope.files_to_read,
    ]

    const depEntries = journal.entries.filter(
      (e: JournalEntry) => depChain.includes(e.task_id) && e.type === "decision"
    )
    const fileEntries = journal.entries.filter(
      (e: JournalEntry) =>
        !depChain.includes(e.task_id) &&
        e.files_affected?.some((f: string) => allFiles.includes(f))
    )
    const recent = journal.entries.slice(-3)
    const combined = dedupeEntries([...depEntries, ...fileEntries, ...recent])
    if (combined.length === 0) return null

    return "## Prior Decisions & Corrections\n" +
      combined.map((e: JournalEntry) => `[${e.task_id} / ${e.type}] ${e.content}`).join("\n")
  } catch { return null }
}

async function buildFileSection(
  filePath: string,
  workspaceRoot: string | undefined,
  remainingBudget: number
): Promise<string | null> {
  try {
    const config = await loadConfig()
    const base = workspaceRoot ?? config.projectRoot
    const fullPath = path.join(base, filePath)

    const content = await fs.readFile(fullPath, "utf-8")
    const lines = content.split("\n")
    const maxLines = Math.floor((remainingBudget * 4) / 10 / 4)
    const truncated = lines.length > maxLines
      ? lines.slice(0, maxLines).join("\n") + `\n// ... truncated (${lines.length - maxLines} more lines)`
      : content
    return `## File: \`${filePath}\`\n\`\`\`\n${truncated}\n\`\`\``
  } catch { return null }
}

function dedupeEntries(entries: JournalEntry[]): JournalEntry[] {
  const seen = new Set<string>()
  return entries.filter((e) => {
    const key = `${e.task_id}-${e.attempt}-${e.type}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}
