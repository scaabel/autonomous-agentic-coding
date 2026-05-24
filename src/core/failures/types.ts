import type { FailedTest } from "../types.js"

// ─── Canonical runtime test primitive ────────────────────────────────────────

export type TestResult = {
  name: string
  status: "passed" | "failed" | "skipped" | "timed_out"
  durationMs: number
  error?: string
  file?: string
}

// FailedTest is a narrowed projection of TestResult (backward compat preserved)
export type { FailedTest }

// ─── Browser console log ──────────────────────────────────────────────────────

export type BrowserLog = {
  type: "log" | "warn" | "error" | "info"
  text: string
  timestamp: number
  location?: string
  source?: "app" | "playwright" | "browser" | "network"
}

// ─── Canonical failure primitive ──────────────────────────────────────────────
// Single representation for all failure sources: static validators,
// runtime sandbox, test runner, and LLM reviewer.

export type NormalizedFailure = {
  id: string
  source: "static" | "runtime" | "test" | "llm-review"
  phase: "install" | "typecheck" | "lint" | "test" | "playwright" | "review"
  code: string
  message: string
  file?: string
  stackTrace?: string
  failedTests?: FailedTest[]
  severity: "hard" | "soft"
  artifactRefs?: {
    logs?: string[]
    screenshots?: string[]
    traces?: string[]
  }
  timestamp: number
}

// ─── Sandbox artifact ─────────────────────────────────────────────────────────
// Full output record from a Docker sandbox execution pass.
// Input to failure normalization, Pi runtime-debugger, and the replay engine.

export type SandboxArtifact = {
  runId: string
  stdout: string
  stderr: string
  exitCode: number
  screenshots: string[]
  traces: string[]
  testResults?: TestResult[]
  browserConsole?: BrowserLog[]
  metrics: {
    durationMs: number
    memoryMb: number
  }
}
