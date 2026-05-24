import type { Task } from "../core/types.js"

export const designerPrompt = (
  task: Task,
  skills: string,
  componentsContext: string,
  mockupHint?: string
) => `
${skills}

## Existing Components — reuse before specifying new
${componentsContext || "No existing components yet — all will be new."}

${mockupHint ? `## Mockup Reference
${mockupHint}
Use this as structural reference only. Design system tokens override any colors/spacing you see.
` : ""}

## Task to Design
${JSON.stringify(task, null, 2)}

## Output Format — return ONLY this JSON, no markdown fences:
{
  "spec": {
    "task_id": "${task.id}",
    "component": "TopLevelComponentName",
    "layout_structure": "auth-card | dashboard | list-page | form-page | modal-form | split-panel | empty-state | plain description",
    "component_inventory": [
      {
        "name": "ExactDesignSystemComponentName",
        "role": "what this component does in the UI",
        "variant": "optional — e.g. default, outline, destructive",
        "notes": "optional — anything Builder must know, not styling"
      }
    ],
    "states": {
      "loading": "describe Skeleton usage — omit if not applicable",
      "error": "where error appears + testid — omit if not applicable",
      "empty": "empty state description — omit if not applicable",
      "success": "redirect path or toast message — omit if not applicable"
    },
    "reused_components": ["ComponentFromRegistry"],
    "new_components": ["NetNewComponent"],
    "testids": {
      "email input": "register-email-input",
      "submit button": "register-submit-button",
      "error message": "register-error-message"
    }
  },
  "rationale": "2-3 sentences: key design decisions and why"
}
`
