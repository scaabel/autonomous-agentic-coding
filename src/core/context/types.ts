// ─── Structured scoped context ────────────────────────────────────────────────
// Replaces the raw string returned by buildScopedContext().
// Structured sections enable selective Pi compression (fileContents first)
// and token-aware routing without full-string scanning.

export type ScopedContextSections = {
  sharedTypes: string
  ownedFiles: string
  journalSlice: string
  fileContents: string
}

export type ScopedContext = {
  text: string
  tokenCount: number
  sections: ScopedContextSections
}
