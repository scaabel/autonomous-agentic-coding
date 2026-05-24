import fs from "fs-extra"
import path from "path"
import type { AgentRole } from "./types.js"
import { loadConfig } from "./config.js"

/**
 * Skill resolution order (first match per filename wins):
 *
 * Monorepo mode (workspace provided):
 *   1. .agent/skills/{workspace}/{role}/{file}.md  ← workspace-specific project skill
 *   2. .agent/skills/{workspace}/shared/{file}.md  ← workspace shared
 *   3. .agent/skills/{role}/{file}.md              ← global project skill
 *   4. .agent/skills/shared/{file}.md              ← global project shared
 *   5. {packageRoot}/skills/{role}/{file}.md       ← package default
 *   6. {packageRoot}/skills/shared/{file}.md       ← package shared default
 *
 * Single-project mode (no workspace):
 *   1. .agent/skills/{role}/{file}.md
 *   2. .agent/skills/shared/{file}.md
 *   3. {packageRoot}/skills/{role}/{file}.md
 *   4. {packageRoot}/skills/shared/{file}.md
 */
export async function loadSkills(
  role: AgentRole,
  workspace?: string
): Promise<string> {
  const config = await loadConfig()
  const projectSkillsDir = path.join(config.projectRoot, config.skillsDir)
  const packageSkillsDir = path.join(config.packageRoot, "skills")

  const chunks: string[] = []
  const seen = new Set<string>()   // dedupe by filename across all dirs

  // Build ordered list of directories to search
  const searchDirs: string[] = []

  if (workspace) {
    // Workspace-specific dirs first
    searchDirs.push(
      path.join(projectSkillsDir, workspace, role),
      path.join(projectSkillsDir, workspace, "shared"),
    )
  }

  // Global project dirs
  searchDirs.push(
    path.join(projectSkillsDir, role),
    path.join(projectSkillsDir, "shared"),
  )

  // Package defaults last
  searchDirs.push(
    path.join(packageSkillsDir, role),
    path.join(packageSkillsDir, "shared"),
  )

  for (const dir of searchDirs) {
    if (!(await fs.pathExists(dir))) continue

    const files = (await fs.readdir(dir))
      .filter((f) => f.endsWith(".md"))
      .sort()

    for (const file of files) {
      if (seen.has(file)) continue   // workspace-specific already loaded this name
      seen.add(file)

      const content = await fs.readFile(path.join(dir, file), "utf-8")
      const label = file.replace(".md", "")
      chunks.push(`### Skill: ${label}\n\n${content}`)
    }
  }

  if (chunks.length === 0) return ""

  return (
    "# Agent Skills & Rules\n\nThese rules are MANDATORY. Follow them exactly.\n\n" +
    chunks.join("\n\n---\n\n")
  )
}

/**
 * Load a file — workspace-aware (path relative to workspace root if provided,
 * else relative to project root).
 */
export async function loadFile(
  filePath: string,
  workspaceAbsoluteRoot?: string
): Promise<string | null> {
  const config = await loadConfig()
  const base = workspaceAbsoluteRoot ?? config.projectRoot
  const fullPath = path.join(base, filePath)
  if (!(await fs.pathExists(fullPath))) return null
  return fs.readFile(fullPath, "utf-8")
}

/**
 * Load multiple files, workspace-aware.
 */
export async function loadContext(
  filePaths: string[],
  workspaceAbsoluteRoot?: string
): Promise<string> {
  const chunks: string[] = []
  for (const filePath of filePaths) {
    const content = await loadFile(filePath, workspaceAbsoluteRoot)
    if (content) {
      chunks.push(`### File: ${filePath}\n\`\`\`\n${content}\n\`\`\``)
    }
  }
  return chunks.length > 0
    ? `# Existing Codebase Context\n\n${chunks.join("\n\n")}`
    : ""
}
