import { z } from "zod"
import { callModel } from "../core/router.js"
import { loadSkills } from "../core/skills.js"
import { plannerPrompt, contractExtractorPrompt } from "../prompts/planner.js"
import { safeParseJSON } from "../utils/parse.js"
import { PlannerOutputSchema, ContractExtractorOutputSchema } from "../core/schemas.js"
import { loadConfig } from "../core/config.js"
import type { PlannerOutput, ApiContract, UiContract, Task } from "../core/types.js"

export async function plannerAgent(task: string): Promise<PlannerOutput> {
  const config = await loadConfig()
  const skills = await loadSkills("planner")
  const prompt = plannerPrompt(task, skills, config.workspaces)
  const res = await callModel(prompt, "smart")
  return safeParseJSON<PlannerOutput>(res.text, PlannerOutputSchema, "planner")
}

export async function contractExtractorAgent(
  summary: string,
  beSteps: Omit<Task, "status" | "attempts">[],
  feSteps: Omit<Task, "status" | "attempts">[]
): Promise<{ apiContract: ApiContract; uiContract: UiContract }> {
  const prompt = contractExtractorPrompt(
    summary,
    JSON.stringify(beSteps, null, 2),
    JSON.stringify(feSteps, null, 2)
  )
  const res = await callModel(prompt, "fast")
  const parsed = safeParseJSON(res.text, ContractExtractorOutputSchema, "contract-extractor")
  return { apiContract: parsed.api_contract, uiContract: parsed.ui_contract }
}
