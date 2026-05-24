import fs from "fs-extra"
import path from "path"
import type { SandboxArtifact } from "../failures/types.js"
import { loadConfig } from "../config.js"

// Artifacts are stored at: <tracesDir>/<runId>/<taskId>-attempt-<n>.json
// This mirrors the RunTrace layout so both are co-located under the same runId dir.

export async function saveArtifact(
  artifact: SandboxArtifact,
  taskId: string,
  attempt: number
): Promise<string> {
  const config = await loadConfig()
  const dir = path.join(config.tracesDir, artifact.runId)
  await fs.ensureDir(dir)
  const filePath = path.join(dir, `${taskId}-attempt-${attempt}.json`)
  await fs.writeJSON(filePath, artifact, { spaces: 2 })
  return filePath
}

export async function loadArtifact(filePath: string): Promise<SandboxArtifact | null> {
  try {
    return await fs.readJSON(filePath) as SandboxArtifact
  } catch {
    return null
  }
}
