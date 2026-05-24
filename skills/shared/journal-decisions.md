# Decisions Journal

## What belongs in decisions[]
Every non-obvious choice you made that a future agent needs to know.

Include:
- Library choices: "Used jsonwebtoken@9 for JWT — token stored as { token: string }"
- Response shape decisions: "Error body is { error: { code: string, message: string } }"
- File structure decisions: "Auth types defined in src/types/auth.ts, exported as AuthResponse"
- Convention choices: "API client in src/lib/api.ts — all fetch calls go through apiCall()"
- Gotchas: "bcrypt requires async — never use bcrypt.hashSync in this codebase"

Do NOT include:
- Things already specified in the task or contract
- Obvious implementation details
- Decisions with no impact on other tasks

## Why this matters
Future agents read your decisions before acting.
A decision you omit forces them to guess — and guesses cause mismatches.
