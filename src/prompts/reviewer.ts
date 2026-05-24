import type { Task, DesignSpec } from "../core/types.js"

export const reviewerPrompt = (
  task: Task,
  diff: string,
  skills: string,
  testingSkills: string,
  apiContractSlice: string,
  designSpec: DesignSpec | null
) => `
${skills}

${testingSkills}

## API Contract (for this task)
${apiContractSlice}

${designSpec ? `## Approved Design Spec
\`\`\`json
${JSON.stringify(designSpec, null, 2)}
\`\`\`

### Design compliance checks
- All components in component_inventory must be present in the diff
- All reused_components must be imported, not recreated
- Every testid in the testids map must appear in the component code exactly
- All states (${Object.keys(designSpec.states).join(", ")}) must be implemented
` : ""}

## Task
${JSON.stringify(task, null, 2)}

## Git Diff
\`\`\`diff
${diff}
\`\`\`

## Your Job
Check that the diff satisfies ALL acceptance criteria, skill rules${designSpec ? ", and the approved design spec" : ""}.

${task.test_scope ? `## Test File Check (required)
Test file must exist at: ${task.test_scope.test_file}
Must cover: ${task.test_scope.critical_paths.join("; ")}
Must use data-testid selectors matching the testids map.
Missing test file or missing testids = immediate fail.` : ""}

## Output Format — return ONLY this JSON, no markdown fences:
{
  "verdict": "pass" | "fail",
  "feedback": ["specific actionable issue"],
  "criteria_results": [
    { "criterion": "exact criterion", "passed": true, "notes": "optional" }
  ]
}
`
