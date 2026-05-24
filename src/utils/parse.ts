import type { ZodSchema } from "zod"

/**
 * Strips markdown fences and parses JSON from LLM output.
 * Throws with a clear message if parsing or validation fails.
 */
export function safeParseJSON<T>(raw: string, schema: ZodSchema<T>, agentName: string): T {
  // Strip markdown fences if present
  const clean = raw
    .replace(/^```(?:json)?\s*/m, "")
    .replace(/```\s*$/m, "")
    .trim()

  let parsed: unknown
  try {
    parsed = JSON.parse(clean)
  } catch (err) {
    throw new Error(
      `[${agentName}] Failed to parse JSON.\n` +
      `Raw output:\n${raw}\n` +
      `Parse error: ${err}`
    )
  }

  const result = schema.safeParse(parsed)
  if (!result.success) {
    throw new Error(
      `[${agentName}] Output failed schema validation.\n` +
      `Errors: ${JSON.stringify(result.error.flatten(), null, 2)}\n` +
      `Parsed value: ${JSON.stringify(parsed, null, 2)}`
    )
  }

  return result.data
}
