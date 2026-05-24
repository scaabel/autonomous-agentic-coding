import fs from "fs-extra"
import path from "path"
import { loadConfig } from "./config.js"

// ─── Types ────────────────────────────────────────────────────────────────────

export type WorkspaceAgentRole = "be" | "fe" | "both"

export type WorkspaceDefinition = {
  root: string                   // relative to monorepo root e.g. "apps/api"
  framework: string              // next | express | expo | fastify | vite | generic
  language: "ts" | "js"
  srcDir: string                 // relative to workspace root
  testDir: string                // relative to workspace root
  skillsDir: string              // relative to monorepo root e.g. ".agent/skills/api"
  agents: WorkspaceAgentRole[]   // which agent roles work in this workspace
  doNotModify?: string[]         // extra protected paths (in addition to global)
}

export type ResolvedWorkspace = WorkspaceDefinition & {
  name: string                   // key from config e.g. "api" | "mobile"
  absoluteRoot: string           // full absolute path
  absoluteSkillsDir: string
  absoluteTestDir: string
  absoluteSrcDir: string
}

// ─── Resolve workspace from config ───────────────────────────────────────────

export async function resolveWorkspace(
  workspaceName: string
): Promise<ResolvedWorkspace> {
  const config = await loadConfig()

  if (!config.workspaces?.[workspaceName]) {
    throw new Error(
      `Workspace "${workspaceName}" not found in .agent/config.json. ` +
      `Available: ${Object.keys(config.workspaces ?? {}).join(", ") || "none"}`
    )
  }

  const def = config.workspaces[workspaceName]
  const absoluteRoot = path.join(config.projectRoot, def.root)

  return {
    ...def,
    name: workspaceName,
    absoluteRoot,
    absoluteSkillsDir: path.join(config.projectRoot, def.skillsDir),
    absoluteTestDir: path.join(absoluteRoot, def.testDir),
    absoluteSrcDir: path.join(absoluteRoot, def.srcDir),
  }
}

export async function getAllWorkspaces(): Promise<ResolvedWorkspace[]> {
  const config = await loadConfig()
  if (!config.workspaces) return []

  return Promise.all(
    Object.keys(config.workspaces).map((name) => resolveWorkspace(name))
  )
}

export async function isMonorepo(): Promise<boolean> {
  const config = await loadConfig()
  return !!(config.workspaces && Object.keys(config.workspaces).length > 0)
}

// ─── Resolve absolute file path for a task ───────────────────────────────────
// Task file paths are relative to workspace root. This makes them absolute.

export async function resolveTaskFilePath(
  filePath: string,
  workspaceName: string | undefined
): Promise<string> {
  if (!workspaceName) {
    // Single-project mode: relative to cwd
    const config = await loadConfig()
    return path.join(config.projectRoot, filePath)
  }

  const workspace = await resolveWorkspace(workspaceName)
  return path.join(workspace.absoluteRoot, filePath)
}

export async function toRelativeTaskPath(
  absolutePath: string,
  workspaceName: string | undefined
): Promise<string> {
  if (!workspaceName) {
    const config = await loadConfig()
    return path.relative(config.projectRoot, absolutePath)
  }
  const workspace = await resolveWorkspace(workspaceName)
  return path.relative(workspace.absoluteRoot, absolutePath)
}

// ─── Detect monorepo structure from filesystem ────────────────────────────────

export type DetectedWorkspace = {
  name: string
  root: string
  framework: string
  language: "ts" | "js"
  agents: WorkspaceAgentRole[]
}

export async function detectMonorepoWorkspaces(
  projectRoot: string
): Promise<DetectedWorkspace[]> {
  const workspaces: DetectedWorkspace[] = []

  // Patterns that indicate monorepo packages
  const packageDirs = ["apps", "packages", "services", "libs"]

  for (const dir of packageDirs) {
    const fullDir = path.join(projectRoot, dir)
    if (!(await fs.pathExists(fullDir))) continue

    const entries = await fs.readdir(fullDir)

    for (const entry of entries) {
      const entryPath = path.join(fullDir, entry)
      const stat = await fs.stat(entryPath)
      if (!stat.isDirectory()) continue

      const pkgJsonPath = path.join(entryPath, "package.json")
      if (!(await fs.pathExists(pkgJsonPath))) continue

      const pkg = await fs.readJSON(pkgJsonPath)
      const deps = { ...pkg.dependencies, ...pkg.devDependencies }

      const framework =
        deps?.next              ? "next"    :
        deps?.expo              ? "expo"    :
        deps?.["react-native"]  ? "react-native" :
        deps?.express           ? "express" :
        deps?.fastify           ? "fastify" :
        deps?.["@remix-run/node"] ? "remix" :
        deps?.vite              ? "vite"    :
                                  "generic"

      const language: "ts" | "js" =
        deps?.typescript ||
        await fs.pathExists(path.join(entryPath, "tsconfig.json"))
          ? "ts" : "js"

      // Infer agents from framework
      const agents: WorkspaceAgentRole[] =
        framework === "express" || framework === "fastify"   ? ["be"] :
        framework === "expo"    || framework === "react-native" ? ["fe"] :
        framework === "next"                                 ? ["both"] :
                                                               ["both"]

      workspaces.push({
        name: entry,
        root: path.join(dir, entry),
        framework,
        language,
        agents,
      })
    }
  }

  return workspaces
}
