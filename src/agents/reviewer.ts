import { callModel } from "../core/router.js"
import { loadSkills } from "../core/skills.js"
import { reviewerPrompt } from "../prompts/reviewer.js"
import { safeParseJSON } from "../utils/parse.js"
import { ReviewerOutputSchema } from "../core/schemas.js"
import type { Task, ReviewerOutput, ApiContract, DesignSpec, ModelResponse } from "../core/types.js"

export type ReviewerResult = {
  output: ReviewerOutput
  response: ModelResponse
}

export async function runReviewer(
  task: Task,
  diff: string,
  apiContract: ApiContract,
  designSpec: DesignSpec | null = null
): Promise<ReviewerResult> {
  const workspace = task.workspace

  const [skills, testingSkills] = await Promise.all([
    loadSkills(task.agent, workspace),
    loadSkills("testing", workspace),
  ])

  const relevantEndpoints = task.contracts?.endpoint
    ? apiContract.endpoints.filter((e) =>
        task.contracts!.endpoint!.includes(e.path)
      )
    : []
  const apiContractSlice = relevantEndpoints.length > 0
    ? JSON.stringify({ endpoints: relevantEndpoints }, null, 2)
    : "No specific endpoint contract for this task."

  const prompt = reviewerPrompt(task, diff, skills, testingSkills, apiContractSlice, designSpec)
  const response = await callModel(prompt, "fast")
  const output = safeParseJSON<ReviewerOutput>(response.text, ReviewerOutputSchema, "reviewer")

  return { output, response }
}
