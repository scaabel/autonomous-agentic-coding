import fs from "fs-extra"
import path from "path"
import type {
  Task,
  TaskQueue,
  RegistryUpdates,
  SharedTypeEntry,
  ComponentEntry,
  HookEntry,
} from "../types.js"

// ─── Types ────────────────────────────────────────────────────────────────────

export type OwnershipRecord = {
  path: string                   // absolute path
  workspace?: string             // monorepo workspace name
  owned_by: string
  agent: "be" | "fe"
  kind: "source" | "test" | "type" | "component" | "hook"
  exports: string[]
  consumers: string[]
  stale: boolean
  created_at: string
  last_modified_at: string
}

export type EndpointRecord = {
  method: string
  path: string
  owned_by: string           // task_id
  consumed_by: string[]      // task_ids whose FE tasks call this endpoint
}

export type DependencyEdge = {
  from: string               // task_id that depends
  to: string                 // task_id depended upon
  via: string[]              // file paths that create the dependency
  stale: boolean             // true if 'to' task was retried after 'from' ran
}

export type OwnershipIndex = {
  run_id: string
  files: Record<string, OwnershipRecord>       // file path → record
  endpoints: Record<string, EndpointRecord>    // "METHOD /path" → record
  dependencies: DependencyEdge[]
  test_to_task: Record<string, string>         // test file path → owning task_id
  mutation_log: MutationEntry[]
}

export type MutationEntry = {
  task_id: string
  attempt: number
  files_changed: string[]
  timestamp: string
  kind: "create" | "modify" | "delete" | "retry"
}

// ─── Paths ────────────────────────────────────────────────────────────────────

import { loadConfig } from "../config.js"

async function getIndexPath(): Promise<string> {
  const config = await loadConfig()
  return path.join(config.docsDir, "registry", "ownership-index.json")
}

// ─── Init ─────────────────────────────────────────────────────────────────────

export async function initOwnershipIndex(
  runId: string,
  tasks: Task[]
): Promise<OwnershipIndex> {
  const index: OwnershipIndex = {
    run_id: runId,
    files: {},
    endpoints: {},
    dependencies: [],
    test_to_task: {},
    mutation_log: [],
  }

  // Pre-populate dependency edges from task depends_on declarations
  for (const task of tasks) {
    for (const depId of task.depends_on) {
      const depTask = tasks.find((t) => t.id === depId)
      if (!depTask) continue

      // Infer shared files: files_to_read in this task that are files_to_create in dep task
      const via = task.scope.files_to_read.filter((f) =>
        depTask.scope.files_to_create.includes(f) ||
        depTask.scope.files_to_modify.includes(f)
      )

      index.dependencies.push({
        from: task.id,
        to: depId,
        via,
        stale: false,
      })
    }

    // Pre-register test ownership from test_scope
    if (task.test_scope?.test_file) {
      index.test_to_task[task.test_scope.test_file] = task.id
    }

    // Pre-register endpoint ownership from contracts
    if (task.agent === "be" && task.contracts?.endpoint) {
      const key = task.contracts.endpoint
      index.endpoints[key] = {
        method: key.split(" ")[0] ?? "GET",
        path: key.split(" ")[1] ?? key,
        owned_by: task.id,
        consumed_by: [],
      }
    }
  }

  // Pre-register endpoint consumers from FE task contracts
  for (const task of tasks) {
    if (task.agent === "fe" && task.contracts?.endpoint) {
      const key = task.contracts.endpoint
      if (index.endpoints[key]) {
        index.endpoints[key].consumed_by.push(task.id)
      }
    }
  }

  const INDEX_PATH = await getIndexPath()
  await fs.ensureDir(path.dirname(INDEX_PATH))
  await fs.writeJSON(INDEX_PATH, index, { spaces: 2 })
  return index
}

// ─── Read ─────────────────────────────────────────────────────────────────────

export async function readOwnershipIndex(): Promise<OwnershipIndex> {
  const INDEX_PATH = await getIndexPath()
  return fs.readJSON(INDEX_PATH) as Promise<OwnershipIndex>
}

// ─── Register file ownership (called after builder passes review) ─────────────

export async function registerOwnership(
  updates: RegistryUpdates,
  taskId: string,
  agent: "be" | "fe",
  attempt: number
): Promise<void> {
  const INDEX_PATH = await getIndexPath()
  const index = await readOwnershipIndex()
  const now = new Date().toISOString()
  const filesChanged: string[] = []

  const allFiles = [
    ...(updates.be_files ?? []).map((f) => ({ ...f, kind: "source" as const, agent: "be" as const })),
    ...(updates.fe_files ?? []).map((f) => ({ ...f, kind: "source" as const, agent: "fe" as const })),
  ]

  for (const f of allFiles) {
    const existing = index.files[f.path]
    const record: OwnershipRecord = {
      path: f.path,
      owned_by: taskId,
      agent,
      kind: "source",
      exports: f.exports,
      consumers: existing?.consumers ?? [],
      stale: false,
      created_at: existing?.created_at ?? now,
      last_modified_at: now,
    }
    index.files[f.path] = record
    filesChanged.push(f.path)

    // If this file was previously owned by a different task and is being modified,
    // mark the original task's dependents as stale
    if (existing && existing.owned_by !== taskId) {
      markDependentsStale(index, existing.owned_by)
    }
  }

  // Register shared type files
  for (const t of updates.shared_types ?? []) {
    const record: OwnershipRecord = {
      path: t.defined_in,
      owned_by: taskId,
      agent,
      kind: "type",
      exports: [t.export],
      consumers: [],
      stale: false,
      created_at: now,
      last_modified_at: now,
    }
    if (!index.files[t.defined_in]) {
      index.files[t.defined_in] = record
    }
  }

  // Register component ownership
  for (const c of updates.components ?? []) {
    if (!index.files[c.path]) {
      index.files[c.path] = {
        path: c.path,
        owned_by: taskId,
        agent,
        kind: "component",
        exports: [c.name],
        consumers: [],
        stale: false,
        created_at: now,
        last_modified_at: now,
      }
    }
  }

  // Register hook ownership
  for (const h of updates.hooks ?? []) {
    if (!index.files[h.path]) {
      index.files[h.path] = {
        path: h.path,
        owned_by: taskId,
        agent,
        kind: "hook",
        exports: [h.name],
        consumers: [],
        stale: false,
        created_at: now,
        last_modified_at: now,
      }
    }
  }

  // Log mutation
  index.mutation_log.push({
    task_id: taskId,
    attempt,
    files_changed: filesChanged,
    timestamp: now,
    kind: attempt > 1 ? "retry" : "create",
  })

  await fs.writeJSON(INDEX_PATH, index, { spaces: 2 })
}

// ─── Register file consumers (when a task reads a file owned by another) ──────

export async function registerConsumer(
  filePath: string,
  consumerTaskId: string
): Promise<void> {
  const INDEX_PATH = await getIndexPath()
  const index = await readOwnershipIndex()
  const record = index.files[filePath]
  if (record && !record.consumers.includes(consumerTaskId)) {
    record.consumers.push(consumerTaskId)
    await fs.writeJSON(INDEX_PATH, index, { spaces: 2 })
  }
}

// ─── Mark stale when a task retries (its consumers need fresh context) ────────

export async function markTaskStale(taskId: string): Promise<void> {
  const INDEX_PATH = await getIndexPath()
  const index = await readOwnershipIndex()
  markDependentsStale(index, taskId)

  index.mutation_log.push({
    task_id: taskId,
    attempt: -1,
    files_changed: Object.values(index.files)
      .filter((f) => f.owned_by === taskId)
      .map((f) => f.path),
    timestamp: new Date().toISOString(),
    kind: "retry",
  })

  await fs.writeJSON(INDEX_PATH, index, { spaces: 2 })
}

function markDependentsStale(index: OwnershipIndex, taskId: string): void {
  // Mark all files owned by this task as stale
  for (const record of Object.values(index.files)) {
    if (record.owned_by === taskId) {
      record.stale = true
    }
  }

  // Mark dependency edges that flow from this task as stale
  for (const edge of index.dependencies) {
    if (edge.to === taskId) {
      edge.stale = true
    }
  }
}

// ─── Queries ──────────────────────────────────────────────────────────────────

export async function getOwner(filePath: string): Promise<string | null> {
  const index = await readOwnershipIndex()
  return index.files[filePath]?.owned_by ?? null
}

export async function getTaskForTest(testFile: string): Promise<string | null> {
  const index = await readOwnershipIndex()
  return index.test_to_task[testFile] ?? null
}

export async function getDependencyChain(taskId: string): Promise<string[]> {
  const index = await readOwnershipIndex()
  const chain: string[] = []
  const visited = new Set<string>()

  function traverse(id: string): void {
    if (visited.has(id)) return
    visited.add(id)
    for (const edge of index.dependencies) {
      if (edge.from === id) {
        chain.push(edge.to)
        traverse(edge.to)
      }
    }
  }

  traverse(taskId)
  return chain
}

export async function getStaleConsumers(taskId: string): Promise<string[]> {
  const index = await readOwnershipIndex()
  const staleConsumers: string[] = []

  for (const record of Object.values(index.files)) {
    if (record.owned_by === taskId && record.stale) {
      staleConsumers.push(...record.consumers)
    }
  }

  return [...new Set(staleConsumers)]
}
