import { callModel } from "../core/router.js"
import { loadSkills } from "../core/skills.js"
import { buildScopedContext } from "../core/context/scoped-context.js"
import { builderPrompt } from "../prompts/builder.js"
import { safeParseJSON } from "../utils/parse.js"
import { BuilderOutputSchema } from "../core/schemas.js"
import { isMonorepo, resolveWorkspace } from "../core/workspace.js"
import type { Task, BuilderOutput, ApiContract, DesignSpec, ModelResponse } from "../core/types.js"

export type BuilderResult = {
  output: BuilderOutput
  response: ModelResponse
}

export async function runBuilder(
  task: Task,
  apiContract: ApiContract,
  designSpec: DesignSpec | null = null,
  feedback: string[] = []
): Promise<BuilderResult> {
  const role = task.agent
  const workspace = task.workspace

  const [skills, testingSkills, context] = await Promise.all([
    loadSkills(role, workspace),
    loadSkills("testing", workspace),
    buildScopedContext(task),
  ])

  const relevantEndpoints = task.contracts?.endpoint
    ? apiContract.endpoints.filter((e) =>
        task.contracts!.endpoint!.includes(e.path)
      )
    : []
  const apiContractSlice = relevantEndpoints.length > 0
    ? JSON.stringify({ endpoints: relevantEndpoints }, null, 2)
    : "No specific endpoint contract for this task."

  const prompt = builderPrompt(
    task, skills, testingSkills, context,
    apiContractSlice, designSpec, feedback
  )
  const response = await callModel(prompt, "smart")
  const output = safeParseJSON<BuilderOutput>(response.text, BuilderOutputSchema, `${role}-builder`)

  return { output, response }
}
