# Registry Awareness

Before writing any code, read the context section carefully.

## Shared Types
- If a type appears in "Shared Types" context, IMPORT it — never redefine it
- Import path is provided in the context
- Adding a duplicate type definition is a validation failure

## Existing Components (FE only)
- If a component appears in "Existing Components", reuse it via import
- Never create a component with the same name as one that already exists
- If you need a variation, extend the existing one — don't duplicate it

## Existing Hooks (FE only)
- If a hook appears in "Existing Hooks", reuse it via import
- Never create a hook with the same name as one that already exists

## BE-Owned Files (FE only)
- Never create or modify files listed under "BE-Owned Files"
- If you need something from a BE file, import from it

## registry_updates in your output
- Only list files you actually created or modified in this task
- Only list new shared types you defined that FE will need
- Only list new components/hooks you created (not ones you imported)
- Accuracy matters — the registry is how future agents know what exists
