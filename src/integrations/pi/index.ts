// ─── Pi skill invoker interface ───────────────────────────────────────────────
// Synchronous request/response semantics (v1).
// Not async callbacks or event-driven webhooks — keeps the retry loop deterministic.

export type PiSkill = "runtime-debugger" | "context-compressor" | "retry-classifier"

export interface PiSkillInvoker {
  invoke<TInput, TOutput>(skill: PiSkill, payload: TInput): Promise<TOutput>
}

// ─── Pi skill output types ────────────────────────────────────────────────────

export type PiDiagnosis = {
  rootCause: string
  confidence: "high" | "medium" | "low"
  repairHints: string[]
  classification: string
}

export type PiCompressedContext = {
  text: string
  tokenCount: number
  compressionRatio: number
}

export type PiRetryClassification = {
  action: "retry" | "escalate" | "abort" | "request_approval"
  confidence: number  // 0–1
  reason: string
}

// ─── Null implementation ──────────────────────────────────────────────────────
// Replace with real Pi SDK when the integration is configured.
// All callers go through the `pi` singleton — swap the class, not the call sites.

export class PiClient implements PiSkillInvoker {
  async invoke<TInput, TOutput>(skill: PiSkill, _payload: TInput): Promise<TOutput> {
    throw new Error(`Pi client not configured. Requested skill: ${skill}`)
  }
}

export const pi: PiSkillInvoker = new PiClient()
