import { callModel } from "../core/router.js"
import { loadSkills } from "../core/skills.js"
import { buildScopedContext } from "../core/context/scoped-context.js"
import { builderPrompt } from "../prompts/builder.js"
import { safeParseJSON } from "../utils/parse.js"
import { BuilderOutputSchema } from "../core/schemas.js"
import { isMonorepo, resolveWorkspace } from "../core/workspace.js"
import { dispatchMutation } from "../core/hooks/dispatcher.js"
import type { Task, BuilderOutput, ApiContract, DesignSpec, ModelResponse } from "../core/types.js"
import type { RetryHistory } from "../core/retry/types.js"

export type BuilderResult = {
  output: BuilderOutput
  response: ModelResponse
}

const EMPTY_RETRY_HISTORY: RetryHistory = {
  attempts: 0,
  failures: [],
  diagnoses: [],
  lastFeedback: [],
}

export async function runBuilder(
  task: Task,
  apiContract: ApiContract,
  designSpec: DesignSpec | null = null,
  feedback: string[] = [],
  retryHistory: RetryHistory = EMPTY_RETRY_HISTORY
): Promise<BuilderResult> {
  const role = task.agent
  const workspace = task.workspace

  const [skills, testingSkills, scopedContext] = await Promise.all([
    loadSkills(role, workspace),
    loadSkills("testing", workspace),
    buildScopedContext(task),
  ])

  // beforeBuild mutation hook — Pi context compressor or other injectors run here
  const buildPayload = await dispatchMutation("beforeBuild", {
    task,
    scopedContext,
    retryHistory,
  })

  const relevantEndpoints = task.contracts?.endpoint
    ? apiContract.endpoints.filter((e) =>
        task.contracts!.endpoint!.includes(e.path)
      )
    : []
  const apiContractSlice = relevantEndpoints.length > 0
    ? JSON.stringify({ endpoints: relevantEndpoints }, null, 2)
    : "No specific endpoint contract for this task."

  const prompt = builderPrompt(
    task, skills, testingSkills,
    buildPayload.scopedContext.text,  // use (potentially compressed) context text
    apiContractSlice, designSpec, feedback
  )
  const response = await callModel(prompt, "smart")
  const output = safeParseJSON<BuilderOutput>(response.text, BuilderOutputSchema, `${role}-builder`)

  return { output, response }
}
