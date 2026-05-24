import fs from "fs-extra"
import path from "path"
import { v4 as uuid } from "uuid"
import type { RunTrace, StepTrace } from "./types.js"
import { loadConfig } from "./config.js"

export function createRun(task: string): RunTrace {
  return {
    id: `run-${uuid()}`,
    task,
    started_at: new Date().toISOString(),
    status: "running",
    steps: [],
  }
}

export function addStepTrace(run: RunTrace, stepTrace: StepTrace): void {
  run.steps.push(stepTrace)
}

export async function saveRun(run: RunTrace): Promise<string> {
  const config = await loadConfig()
  await fs.ensureDir(config.tracesDir)
  const filePath = path.join(config.tracesDir, `${run.id}.json`)
  await fs.writeJSON(filePath, run, { spaces: 2 })
  return filePath
}

export async function finalizeRun(
  run: RunTrace,
  status: RunTrace["status"]
): Promise<string> {
  run.finished_at = new Date().toISOString()
  run.status = status
  return saveRun(run)
}
