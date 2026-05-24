import type { Task, DesignSpec } from "../core/types.js"

export const builderPrompt = (
  task: Task,
  skills: string,
  testingSkills: string,
  context: string,
  apiContractSlice: string,
  designSpec: DesignSpec | null,
  feedback: string[] = []
) => `
${skills}

${testingSkills}

${context}

## API Contract (for this task)
${apiContractSlice}

${designSpec ? `## Design Spec (approved — implement this exactly)
\`\`\`json
${JSON.stringify(designSpec, null, 2)}
\`\`\`

### Design implementation rules
- Use ONLY the components listed in component_inventory — no others
- Reuse every component in reused_components — import, never recreate
- Use the exact data-testid values from testids — never invent new ones
- Implement every state described in states (loading, error, empty, success)
- layout_structure tells you the page/component structure to follow
` : ""}

## Task
${JSON.stringify(task, null, 2)}

${feedback.length > 0 ? `## ⚠️ Previous Attempt Failed — Fix These Issues
${feedback.map((f) => `- ${f}`).join("\n")}

Do NOT repeat the same mistakes.` : ""}

## Implementation Rules
- Only create/modify files in scope.files_to_create and scope.files_to_modify
- Only read files in scope.files_to_read
- Never touch files in scope.do_not_touch
- Import shared types from existing paths — never redefine
- Every change must directly satisfy an acceptance criterion

## Test File Rules (when test_scope is present)
- MUST include test file at test_scope.test_file in changes[]
- Test must cover ALL critical_paths in test_scope.critical_paths
- Use exact testid values from design spec testids map
- data-testid attributes in component MUST match testids map exactly
- Use storageState fixture if test_scope.requires_auth is true
- Include afterEach cleanup for any created test data

## registry_updates rules
- be_files / fe_files: files you created or modified
- shared_types: new types FE needs (BE only)
- components: new React components created (FE only)
- hooks: new custom hooks created (FE only)
- Never include test files in registry_updates

## Output Format — return ONLY this JSON, no markdown fences:
{
  "changes": [
    { "file": "path/to/file.tsx", "action": "create", "content": "full content" },
    { "file": "tests/e2e/features/[feature]/[name].e2e.ts", "action": "create", "content": "test content" }
  ],
  "summary": "what was implemented",
  "registry_updates": {
    "be_files": [], "fe_files": [], "shared_types": [], "components": [], "hooks": []
  },
  "decisions": ["decision 1"]
}
`
