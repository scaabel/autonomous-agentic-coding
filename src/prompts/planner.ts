import type { WorkspaceDefinition } from "../core/workspace.js"

export const plannerPrompt = (
  task: string,
  skills: string,
  workspaces?: Record<string, WorkspaceDefinition>
) => `
${skills}

## Your Job
You are a senior engineer creating a structured task queue for a multi-agent system.
Break the task into small, independently executable steps for BE and FE agents.

${workspaces ? `## Project Workspaces
This is a monorepo. Each task MUST include a "workspace" field matching one of these:

${Object.entries(workspaces).map(([name, ws]) => `### ${name}
- Root: ${ws.root}
- Framework: ${ws.framework}
- Language: ${ws.language}
- Agents: ${ws.agents.join(", ")}
- Src dir: ${ws.srcDir}/`).join("\n\n")}

### Workspace assignment rules
- backend routes, middleware, DB, APIs → assign to the BE workspace
- screens, components, navigation, UI → assign to the FE/mobile workspace
- shared types consumed by BOTH workspaces → define in BE workspace, reference path for FE imports
- File paths in scope are RELATIVE TO THE WORKSPACE ROOT (not the monorepo root)
  e.g. for workspace "api" with root "apps/api", use "src/routes/auth.ts" not "apps/api/src/routes/auth.ts"

` : ""}## Critical Rules
- BE steps that define an endpoint must always precede FE steps that consume it
- Every FE step must list the exact endpoint paths it will call in contracts.endpoint
- Each step must touch at most 3 files — split if more are needed
- acceptance_criteria must be specific and testable
- files_to_create and files_to_modify must list exact paths relative to workspace root
- do_not_touch must list directories/files the agent must never touch
- depends_on must list step IDs this step needs completed first

## Test Scope Rules
- Every FE step producing a user-visible page MUST include a test_scope
- BE steps defining API endpoints MUST include a test_scope (type: "integration")
- test_file path is relative to workspace root: tests/e2e/features/[feature]/[name].e2e.ts

## Task
${task}

## Output Format — return ONLY this JSON, no markdown fences:
{
  "summary": "one paragraph: what will be built and why",
  "be_steps": [
    {
      "id": "be-001",
      "agent": "be",
      ${workspaces ? '"workspace": "api",' : ''}
      "title": "POST /api/v1/auth/register route",
      "description": "detailed description",
      "scope": {
        "files_to_create": ["src/routes/auth.ts"],
        "files_to_modify": [],
        "files_to_read": ["src/db/client.ts"],
        "do_not_touch": ["src/middleware/"]
      },
      "contracts": {
        "endpoint": "POST /api/v1/auth/register",
        "request": { "email": "string", "password": "string" },
        "response_success": { "status": 201, "body": { "data": { "id": "string", "email": "string" } } },
        "response_errors": [{ "status": 400, "code": "VALIDATION_ERROR" }]
      },
      "acceptance_criteria": ["criterion 1", "criterion 2"],
      "test_scope": {
        "test_file": "tests/e2e/features/auth/register-api.e2e.ts",
        "test_type": "integration",
        "critical_paths": ["POST /api/v1/auth/register returns 201 on valid input"],
        "requires_auth": false
      },
      "depends_on": []
    }
  ],
  "fe_steps": [
    {
      "id": "fe-001",
      "agent": "fe",
      ${workspaces ? '"workspace": "mobile",' : ''}
      "title": "RegisterScreen",
      "description": "detailed description",
      "scope": {
        "files_to_create": ["src/screens/RegisterScreen.tsx"],
        "files_to_modify": [],
        "files_to_read": ["src/lib/api.ts"],
        "do_not_touch": ["src/navigation/"]
      },
      "contracts": { "endpoint": "POST /api/v1/auth/register" },
      "acceptance_criteria": ["criterion 1"],
      "test_scope": {
        "test_file": "e2e/features/auth/register-screen.e2e.ts",
        "test_type": "e2e",
        "critical_paths": ["User fills form and submits successfully"],
        "requires_auth": false
      },
      "depends_on": ["be-001"]
    }
  ]
}
`

export const contractExtractorPrompt = (
  prdSummary: string,
  beStepsJson: string,
  feStepsJson: string
) => `
Extract machine-readable contracts from this PRD.

## Summary
${prdSummary}

## BE Steps
${beStepsJson}

## FE Steps
${feStepsJson}

Return ONLY this JSON, no markdown fences:
{
  "api_contract": {
    "version": "v1",
    "base_path": "/api/v1",
    "endpoints": [
      {
        "method": "POST",
        "path": "/api/v1/auth/register",
        "description": "Register new user",
        "request_body": { "email": "string", "password": "string" },
        "response": { "data": { "id": "string", "email": "string" } },
        "errors": [{ "status": 400, "message": "Validation error" }]
      }
    ]
  },
  "ui_contract": {
    "components": [
      {
        "name": "RegisterScreen",
        "description": "User registration screen",
        "props": { "navigation": "NavigationProp" },
        "consumes_endpoints": ["/api/v1/auth/register"]
      }
    ],
    "pages": [
      { "path": "Register", "name": "RegisterScreen", "components": ["RegisterScreen"] }
    ]
  }
}
`
