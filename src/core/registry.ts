import fs from "fs-extra"
import path from "path"
import type {
  BeRegistry, FeRegistry, SharedTypesRegistry,
  ComponentsRegistry, HooksRegistry, RunJournal,
  TaskQueue, RegistryUpdates, JournalEntry, Task,
  RegistryFileEntry, SharedTypeEntry, ComponentEntry, HookEntry,
} from "./types.js"
import { loadConfig } from "./config.js"

// ─── Paths ────────────────────────────────────────────────────────────────────

export async function getRegistryPaths() {
  const config = await loadConfig()
  const docsDir = config.docsDir
  const registryDir = path.join(docsDir, "registry")
  return {
    taskQueue:    path.join(docsDir, "task-queue.json"),
    journal:      path.join(docsDir, "run-journal.json"),
    apiContract:  path.join(docsDir, "api-contract.json"),
    uiContract:   path.join(docsDir, "ui-contract.json"),
    prd:          path.join(docsDir, "prd.json"),
    be:           path.join(registryDir, "be-registry.json"),
    fe:           path.join(registryDir, "fe-registry.json"),
    sharedTypes:  path.join(registryDir, "shared-types.json"),
    components:   path.join(registryDir, "components-registry.json"),
    hooks:        path.join(registryDir, "hooks-registry.json"),
    _registryDir: registryDir,
    _docsDir:     docsDir,
  }
}

// Keep REGISTRY_PATHS for any legacy callers — now a runtime error to catch migrations
export const REGISTRY_PATHS = new Proxy({} as Record<string, string>, {
  get(_t, prop: string) {
    throw new Error(`REGISTRY_PATHS.${prop} is synchronous — use getRegistryPaths() instead`)
  },
})

// ─── Init ─────────────────────────────────────────────────────────────────────

export async function initRegistry(runId: string, feature: string): Promise<void> {
  const p = await getRegistryPaths()
  await fs.ensureDir(p._docsDir)
  await fs.ensureDir(p._registryDir)

  await Promise.all([
    fs.writeJSON(p.be,         { files: [] }      satisfies BeRegistry,         { spaces: 2 }),
    fs.writeJSON(p.fe,         { files: [] }      satisfies FeRegistry,         { spaces: 2 }),
    fs.writeJSON(p.sharedTypes,{ types: [] }      satisfies SharedTypesRegistry,{ spaces: 2 }),
    fs.writeJSON(p.components, { components: [] } satisfies ComponentsRegistry, { spaces: 2 }),
    fs.writeJSON(p.hooks,      { hooks: [] }      satisfies HooksRegistry,      { spaces: 2 }),
    fs.writeJSON(p.journal, { run_id: runId, feature, entries: [] } satisfies RunJournal, { spaces: 2 }),
  ])
}

// ─── Reads ────────────────────────────────────────────────────────────────────

export async function readJSON<T>(filePath: string): Promise<T> {
  return fs.readJSON(filePath) as Promise<T>
}

export async function readTaskQueue(): Promise<TaskQueue> {
  const p = await getRegistryPaths()
  return readJSON<TaskQueue>(p.taskQueue)
}

export async function readJournal(): Promise<RunJournal> {
  const p = await getRegistryPaths()
  return readJSON<RunJournal>(p.journal)
}

// ─── Task Queue updates ───────────────────────────────────────────────────────

export async function updateTaskStatus(
  taskId: string, status: Task["status"], attempts: number
): Promise<void> {
  const p = await getRegistryPaths()
  const queue = await readTaskQueue()
  const task = queue.tasks.find((t: Task) => t.id === taskId)
  if (task) { task.status = status; task.attempts = attempts }
  await fs.writeJSON(p.taskQueue, queue, { spaces: 2 })
}

// ─── Registry updates ─────────────────────────────────────────────────────────

export async function applyRegistryUpdates(
  updates: RegistryUpdates, taskId: string
): Promise<void> {
  const p = await getRegistryPaths()
  const promises: Promise<void>[] = []

  if (updates.be_files?.length) {
    promises.push((async () => {
      const reg = await readJSON<BeRegistry>(p.be)
      for (const f of updates.be_files!) {
        const idx = reg.files.findIndex((e: RegistryFileEntry) => e.path === f.path)
        const entry: RegistryFileEntry = { ...f, task_id: taskId }
        if (idx >= 0) reg.files[idx] = entry; else reg.files.push(entry)
      }
      await fs.writeJSON(p.be, reg, { spaces: 2 })
    })())
  }

  if (updates.fe_files?.length) {
    promises.push((async () => {
      const reg = await readJSON<FeRegistry>(p.fe)
      for (const f of updates.fe_files!) {
        const idx = reg.files.findIndex((e: RegistryFileEntry) => e.path === f.path)
        const entry: RegistryFileEntry = { ...f, task_id: taskId }
        if (idx >= 0) reg.files[idx] = entry; else reg.files.push(entry)
      }
      await fs.writeJSON(p.fe, reg, { spaces: 2 })
    })())
  }

  if (updates.shared_types?.length) {
    promises.push((async () => {
      const reg = await readJSON<SharedTypesRegistry>(p.sharedTypes)
      for (const t of updates.shared_types!) {
        const idx = reg.types.findIndex((e: SharedTypeEntry) => e.name === t.name)
        const entry: SharedTypeEntry = { ...t, task_id: taskId }
        if (idx >= 0) reg.types[idx] = entry; else reg.types.push(entry)
      }
      await fs.writeJSON(p.sharedTypes, reg, { spaces: 2 })
    })())
  }

  if (updates.components?.length) {
    promises.push((async () => {
      const reg = await readJSON<ComponentsRegistry>(p.components)
      for (const c of updates.components!) {
        const idx = reg.components.findIndex((e: ComponentEntry) => e.name === c.name)
        const entry: ComponentEntry = { ...c, task_id: taskId }
        if (idx >= 0) reg.components[idx] = entry; else reg.components.push(entry)
      }
      await fs.writeJSON(p.components, reg, { spaces: 2 })
    })())
  }

  if (updates.hooks?.length) {
    promises.push((async () => {
      const reg = await readJSON<HooksRegistry>(p.hooks)
      for (const h of updates.hooks!) {
        const idx = reg.hooks.findIndex((e: HookEntry) => e.name === h.name)
        const entry: HookEntry = { ...h, task_id: taskId }
        if (idx >= 0) reg.hooks[idx] = entry; else reg.hooks.push(entry)
      }
      await fs.writeJSON(p.hooks, reg, { spaces: 2 })
    })())
  }

  await Promise.all(promises)
}

// ─── Journal ──────────────────────────────────────────────────────────────────

export async function appendJournal(entry: JournalEntry): Promise<void> {
  const p = await getRegistryPaths()
  const journal = await readJournal()
  journal.entries.push(entry)
  await fs.writeJSON(p.journal, journal, { spaces: 2 })
}
