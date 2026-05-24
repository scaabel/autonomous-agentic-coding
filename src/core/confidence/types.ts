// ─── Confidence scoring ───────────────────────────────────────────────────────
// Output of the confidence engine; gates the beforeCommit hook.
// The signals array makes scores auditable and thresholds tunable.

export type ConfidenceTier = "high" | "medium" | "low"

export type ConfidenceSignals = {
  staticPassRate: number       // fraction of static checks that passed (0–1)
  reviewPassRate: number       // LLM reviewer criteria pass rate (0–1)
  runtimePassRate: number      // test suite pass rate (0–1)
  attemptNumber: number        // 1 = first pass, higher = more retries
  ownershipCompliance: number  // fraction of touched files with no ownership violations (0–1)
  piDiagnosisConfidence?: number // Pi's confidence in its diagnosis (0–1), if available
}

export type ConfidenceResult = {
  score: number                // weighted composite (0–1)
  tier: ConfidenceTier
  signals: ConfidenceSignals
  explanation: string[]        // human-readable audit trail; surfaced in commit logs + dashboards
}
