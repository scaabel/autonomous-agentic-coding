import Anthropic from "@anthropic-ai/sdk"
import type { ModelTier } from "./types.js"
import { loadConfig } from "./config.js"
import { recordSpend, isBudgetExhausted } from "./budget.js"

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const PRICING: Record<string, { input: number; output: number }> = {
  "claude-sonnet-4-6":         { input: 3.0, output: 15.0 },
  "claude-haiku-4-5-20251001": { input: 0.8, output: 4.0  },
}

export async function resolveModel(tier: ModelTier): Promise<string> {
  const config = await loadConfig()
  return tier === "fast" ? config.fastModel : config.model
}

export type ModelResponse = {
  text: string
  input_tokens: number
  output_tokens: number
  cost_usd: number
}

export async function callModel(
  prompt: string,
  tier: ModelTier = "smart",
  systemPrompt?: string
): Promise<ModelResponse> {
  // Check budget before spending tokens
  if (await isBudgetExhausted()) {
    throw new Error("BUDGET_EXHAUSTED: Monthly budget limit reached. Increase monthlyBudgetUsd in .agent/config.json")
  }

  const model = await resolveModel(tier)

  const response = await client.messages.create({
    model,
    max_tokens: 8096,
    system: systemPrompt ??
      "You are a precise AI agent. Always respond with valid JSON only. No markdown fences, no prose, no explanation.",
    messages: [{ role: "user", content: prompt }],
  })

  const block = response.content[0]
  if (block.type !== "text") throw new Error(`Unexpected response type: ${block.type}`)

  const inputTokens  = response.usage.input_tokens
  const outputTokens = response.usage.output_tokens
  const pricing = PRICING[model] ?? { input: 3.0, output: 15.0 }
  const costUsd =
    (inputTokens  / 1_000_000) * pricing.input +
    (outputTokens / 1_000_000) * pricing.output

  // Record spend — this checks thresholds and prints warnings automatically
  await recordSpend(costUsd, inputTokens, outputTokens)

  return { text: block.text, input_tokens: inputTokens, output_tokens: outputTokens, cost_usd: costUsd }
}
