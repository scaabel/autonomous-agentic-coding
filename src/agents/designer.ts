import fs from "fs-extra"
import path from "path"
import Anthropic from "@anthropic-ai/sdk"
import { loadSkills } from "../core/skills.js"
import { readJSON, getRegistryPaths } from "../core/registry.js"
import { buildScopedContext } from "../core/context/scoped-context.js"
import { designerPrompt } from "../prompts/designer.js"
import { safeParseJSON } from "../utils/parse.js"
import { DesignOutputSchema } from "../core/schemas.js"
import { askYesNo, waitForEnter } from "../utils/input.js"
import type {
  Task,
  DesignOutput,
  DesignSpec,
  ComponentsRegistry,
  ModelResponse,
} from "../core/types.js"
import chalk from "chalk"

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const DESIGNS_DIR = "docs/designs"

export type DesignerResult = {
  output: DesignOutput
  response: ModelResponse
  specPath: string
}

// ─── Main entry ───────────────────────────────────────────────────────────────

export async function runDesigner(
  task: Task,
  mockupPath?: string
): Promise<DesignerResult> {
  await fs.ensureDir(DESIGNS_DIR)

  const skills = await loadSkills("designer")
  const componentsContext = await buildComponentsContext()
  const mockupHint = mockupPath ? await describeMockup(mockupPath, task) : undefined

  const prompt = designerPrompt(task, skills, componentsContext, mockupHint)

  // Designer uses Haiku — it's structured extraction not reasoning
  const model = process.env.FAST_MODEL ?? "claude-haiku-4-5-20251001"
  const apiResponse = await client.messages.create({
    model,
    max_tokens: 2048,
    system: "You are a UI designer producing component specs. Always respond with valid JSON only. No markdown fences.",
    messages: [{ role: "user", content: prompt }],
  })

  const block = apiResponse.content[0]
  if (block.type !== "text") throw new Error("Unexpected designer response type")

  const response: ModelResponse = {
    text: block.text,
    input_tokens: apiResponse.usage.input_tokens,
    output_tokens: apiResponse.usage.output_tokens,
    cost_usd:
      (apiResponse.usage.input_tokens / 1_000_000) * 0.8 +
      (apiResponse.usage.output_tokens / 1_000_000) * 4.0,
  }

  const output = safeParseJSON<DesignOutput>(response.text, DesignOutputSchema, "designer")

  // Always save spec to docs/designs/ before human review
  const specPath = path.join(DESIGNS_DIR, `${task.id}-spec.json`)
  await fs.writeJSON(specPath, output, { spaces: 2 })

  // ── Always pause for human review ────────────────────────────────────────
  await humanReviewCheckpoint(task, output.spec, specPath)

  // Re-read spec after review (human may have edited it)
  const finalOutput = await fs.readJSON(specPath) as DesignOutput

  return { output: finalOutput, response, specPath }
}

// ─── Human review checkpoint ──────────────────────────────────────────────────

async function humanReviewCheckpoint(
  task: Task,
  spec: DesignSpec,
  specPath: string
): Promise<void> {
  console.log(chalk.bold.yellow(`\n  🎨 Design spec ready for review\n`))
  console.log(chalk.dim(`  Task:       ${task.title}`))
  console.log(chalk.dim(`  Component:  ${spec.component}`))
  console.log(chalk.dim(`  Layout:     ${spec.layout_structure}`))
  console.log(chalk.dim(`  Components: ${spec.component_inventory.map((c) => c.name).join(", ")}`))
  console.log(chalk.dim(`  Testids:    ${Object.values(spec.testids).join(", ")}`))

  if (spec.reused_components.length > 0) {
    console.log(chalk.dim(`  Reusing:    ${spec.reused_components.join(", ")}`))
  }
  if (spec.new_components.length > 0) {
    console.log(chalk.dim(`  New:        ${spec.new_components.join(", ")}`))
  }

  console.log(chalk.dim(`\n  Full spec:  ${specPath}`))
  console.log(chalk.dim("  Edit the spec file if needed, then confirm.\n"))

  await waitForEnter(chalk.yellow("  Press Enter when the spec is ready..."))
}

// ─── Components context for prompt ───────────────────────────────────────────

async function buildComponentsContext(): Promise<string> {
  try {
    const p = await getRegistryPaths()
    const reg = await readJSON<ComponentsRegistry>(p.components)
    if (reg.components.length === 0) return ""

    return (
      "Components already built — reference these by name, do not recreate:\n" +
      reg.components
        .map((c) => `- ${c.name} at ${c.path}`)
        .join("\n")
    )
  } catch {
    return ""
  }
}

// ─── Vision: describe mockup via Claude vision ────────────────────────────────

async function describeMockup(
  mockupPath: string,
  task: Task
): Promise<string> {
  const ext = path.extname(mockupPath).toLowerCase()
  const mediaType = ext === ".png"
    ? "image/png"
    : ext === ".webp"
    ? "image/webp"
    : "image/jpeg"

  let imageData: string
  try {
    const buffer = await fs.readFile(mockupPath)
    imageData = buffer.toString("base64")
  } catch {
    console.log(chalk.dim(`  Mockup not found at ${mockupPath} — proceeding without it`))
    return ""
  }

  const visionResponse = await client.messages.create({
    model: process.env.FAST_MODEL ?? "claude-haiku-4-5-20251001",
    max_tokens: 512,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: { type: "base64", media_type: mediaType, data: imageData },
          },
          {
            type: "text",
            text: `Describe the layout structure and UI components visible in this mockup for a component called "${task.title}". Be brief — 3-5 sentences covering: layout type, main components present, and any notable states shown. Do not describe colors or spacing values.`,
          },
        ],
      },
    ],
  })

  const block = visionResponse.content[0]
  return block.type === "text" ? block.text : ""
}
