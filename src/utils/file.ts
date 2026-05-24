import fs from "fs-extra"
import path from "path"
import type { Change } from "../core/types.js"
import { resolveTaskFilePath } from "../core/workspace.js"

/**
 * Apply file changes to disk.
 * In monorepo mode, paths are resolved relative to the workspace root.
 * In single-project mode, paths are resolved relative to cwd.
 */
export async function applyChanges(
  changes: Change[],
  workspace?: string
): Promise<void> {
  for (const change of changes) {
    const absolutePath = await resolveTaskFilePath(change.file, workspace)

    switch (change.action) {
      case "create":
      case "update":
        await fs.outputFile(absolutePath, change.content, "utf-8")
        break
      case "delete":
        await fs.remove(absolutePath)
        break
    }
  }
}
