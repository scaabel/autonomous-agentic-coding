import fs from "fs-extra"
import type { Task, BuilderOutput, Change, ApiContract, DesignSpec } from "../types.js"
import { readOwnershipIndex } from "../kernel/ownership.js"
import { REGISTRY_PATHS } from "../registry.js"

// ─── Types ────────────────────────────────────────────────────────────────────

export type ValidationResult = {
  passed: boolean
  errors: ValidationError[]
  warnings: ValidationWarning[]
}

export type ValidationError = {
  code: string
  message: string
  file?: string
  line?: number
}

export type ValidationWarning = {
  code: string
  message: string
  file?: string
}

// ─── Pipeline entry point ─────────────────────────────────────────────────────

/**
 * Runs all static validators before the LLM reviewer.
 * Returns immediately on first hard error (ownership violations).
 * Collects all soft errors (schema, contract) before returning.
 */
export async function runStaticValidation(
  task: Task,
  output: BuilderOutput,
  apiContract: ApiContract,
  designSpec: DesignSpec | null
): Promise<ValidationResult> {
  const errors: ValidationError[] = []
  const warnings: ValidationWarning[] = []

  // ── 1. Ownership validation (hard — runs first) ───────────────────────────
  const ownershipErrors = await validateOwnership(task, output)
  errors.push(...ownershipErrors)

  // Short-circuit: ownership violations are fatal
  if (ownershipErrors.length > 0) {
    return { passed: false, errors, warnings }
  }

  // ── 2. Schema validation ──────────────────────────────────────────────────
  const schemaErrors = validateSchema(output)
  errors.push(...schemaErrors)

  // ── 3. Contract validation ────────────────────────────────────────────────
  const contractErrors = await validateContracts(task, output, apiContract)
  errors.push(...contractErrors)

  // ── 4. AST validation ─────────────────────────────────────────────────────
  const { errors: astErrors, warnings: astWarnings } = await validateAST(
    task, output, designSpec
  )
  errors.push(...astErrors)
  warnings.push(...astWarnings)

  // ── 5. Test file validation ───────────────────────────────────────────────
  if (task.test_scope) {
    const testErrors = validateTestFile(task, output)
    errors.push(...testErrors)
  }

  return {
    passed: errors.length === 0,
    errors,
    warnings,
  }
}

// ─── Validator 1: Ownership ───────────────────────────────────────────────────

async function validateOwnership(
  task: Task,
  output: BuilderOutput
): Promise<ValidationError[]> {
  const errors: ValidationError[] = []

  try {
    const index = await readOwnershipIndex()
    const allowedToCreate = task.scope.files_to_create
    const allowedToModify = task.scope.files_to_modify
    const doNotTouch = task.scope.do_not_touch

    for (const change of output.changes) {
      const { file, action } = change

      // Skip test files — they're always allowed for the owning task
      if (file.includes("tests/e2e/") && task.test_scope?.test_file === file) continue

      // Check do_not_touch (prefix match for directories)
      const touchViolation = doNotTouch.some(
        (forbidden) => file === forbidden || file.startsWith(forbidden.endsWith("/") ? forbidden : forbidden + "/")
      )
      if (touchViolation) {
        errors.push({
          code: "OWNERSHIP_FORBIDDEN",
          message: `Task ${task.id} attempted to ${action} \`${file}\` which is in do_not_touch`,
          file,
        })
        continue
      }

      // Check cross-agent ownership violation
      const existingOwner = index.files[file]
      if (existingOwner && existingOwner.owned_by !== task.id) {
        const expectedAgent = existingOwner.agent
        if (expectedAgent !== task.agent) {
          errors.push({
            code: "OWNERSHIP_CROSS_AGENT",
            message: `Task ${task.id} (${task.agent}) attempted to ${action} \`${file}\` owned by ${existingOwner.owned_by} (${expectedAgent})`,
            file,
          })
          continue
        }
      }

      // Validate file is in declared scope
      if (action === "create" && !allowedToCreate.includes(file)) {
        // Soft error for test files
        if (file.includes("tests/e2e/features/")) continue

        errors.push({
          code: "OWNERSHIP_UNDECLARED_CREATE",
          message: `Task ${task.id} created \`${file}\` but it is not in scope.files_to_create`,
          file,
        })
      }

      if (action === "update" && !allowedToModify.includes(file) && !allowedToCreate.includes(file)) {
        errors.push({
          code: "OWNERSHIP_UNDECLARED_MODIFY",
          message: `Task ${task.id} modified \`${file}\` but it is not in scope.files_to_modify or files_to_create`,
          file,
        })
      }
    }
  } catch {
    // Ownership index not yet initialised — skip
  }

  return errors
}

// ─── Validator 2: Schema ──────────────────────────────────────────────────────

function validateSchema(output: BuilderOutput): ValidationError[] {
  const errors: ValidationError[] = []

  for (const change of output.changes) {
    if (!change.file || typeof change.file !== "string") {
      errors.push({ code: "SCHEMA_MISSING_FILE", message: "Change is missing file path" })
    }
    if (!["create", "update", "delete"].includes(change.action)) {
      errors.push({
        code: "SCHEMA_INVALID_ACTION",
        message: `Invalid action "${change.action}" on file ${change.file}`,
        file: change.file,
      })
    }
    if (change.action !== "delete" && (!change.content || change.content.trim() === "")) {
      errors.push({
        code: "SCHEMA_EMPTY_CONTENT",
        message: `File ${change.file} has empty content for action ${change.action}`,
        file: change.file,
      })
    }
  }

  if (!output.summary || output.summary.trim() === "") {
    errors.push({ code: "SCHEMA_MISSING_SUMMARY", message: "Builder output missing summary" })
  }

  if (!Array.isArray(output.decisions)) {
    errors.push({ code: "SCHEMA_INVALID_DECISIONS", message: "decisions must be an array" })
  }

  return errors
}

// ─── Validator 3: Contract ────────────────────────────────────────────────────

async function validateContracts(
  task: Task,
  output: BuilderOutput,
  apiContract: ApiContract
): Promise<ValidationError[]> {
  const errors: ValidationError[] = []

  if (task.agent !== "be" || !task.contracts?.endpoint) return errors

  const endpointKey = task.contracts.endpoint
  const contractEndpoint = apiContract.endpoints.find(
    (e) => `${e.method} ${e.path}` === endpointKey || e.path === endpointKey
  )

  if (!contractEndpoint) return errors

  // Check that the handler file was actually created/modified
  const handlerFiles = output.changes.filter(
    (c) => task.scope.files_to_create.includes(c.file) ||
           task.scope.files_to_modify.includes(c.file)
  )

  if (handlerFiles.length === 0) {
    errors.push({
      code: "CONTRACT_NO_HANDLER",
      message: `No handler file created for endpoint ${endpointKey}`,
    })
    return errors
  }

  // Check contract response shape is referenced in the code
  for (const change of handlerFiles) {
    if (!change.content) continue

    // Check status codes from contract appear in handler
    for (const err of contractEndpoint.errors) {
      if (!change.content.includes(String(err.status))) {
        errors.push({
          code: "CONTRACT_MISSING_STATUS",
          message: `Handler for ${endpointKey} does not reference error status ${err.status}`,
          file: change.file,
        })
      }
    }

    // Check response envelope pattern
    if (!change.content.includes('"data"') && !change.content.includes("data:")) {
      errors.push({
        code: "CONTRACT_MISSING_ENVELOPE",
        message: `Handler for ${endpointKey} may not follow { data: ... } response envelope`,
        file: change.file,
      })
    }
  }

  return errors
}

// ─── Validator 4: AST (lightweight text-based) ───────────────────────────────

async function validateAST(
  task: Task,
  output: BuilderOutput,
  designSpec: DesignSpec | null
): Promise<{ errors: ValidationError[]; warnings: ValidationWarning[] }> {
  const errors: ValidationError[] = []
  const warnings: ValidationWarning[] = []

  for (const change of output.changes) {
    if (!change.content || change.action === "delete") continue

    const isTypescript = change.file.endsWith(".ts") || change.file.endsWith(".tsx")
    const isComponent = change.file.endsWith(".tsx")
    const isTestFile = change.file.includes("tests/e2e/")

    if (!isTypescript) continue

    // ── Forbidden patterns ───────────────────────────────────────────────────

    // No inline styles in React components
    if (isComponent && change.content.includes("style={{")) {
      errors.push({
        code: "AST_INLINE_STYLE",
        message: `Component \`${change.file}\` uses inline styles — use Tailwind classes instead`,
        file: change.file,
      })
    }

    // No raw hex values
    const hexPattern = /#[0-9a-fA-F]{3,6}(?![0-9a-fA-F])/g
    const hexMatches = change.content.match(hexPattern)
    if (isComponent && hexMatches) {
      errors.push({
        code: "AST_RAW_HEX",
        message: `Component \`${change.file}\` contains raw hex values: ${hexMatches.slice(0, 3).join(", ")} — use CSS variables`,
        file: change.file,
      })
    }

    // No arbitrary Tailwind values
    const arbitraryPattern = /\[(?:\d+px|\d+rem|#[0-9a-f]+)\]/gi
    if (isComponent && arbitraryPattern.test(change.content)) {
      warnings.push({
        code: "AST_ARBITRARY_TAILWIND",
        message: `Component \`${change.file}\` uses arbitrary Tailwind values — use design system scale`,
        file: change.file,
      })
    }

    // No `any` type in TypeScript (warn only)
    if (!isTestFile && change.content.includes(": any")) {
      warnings.push({
        code: "AST_IMPLICIT_ANY",
        message: `File \`${change.file}\` uses \`any\` type — use specific types`,
        file: change.file,
      })
    }

    // No console.log in non-test files
    if (!isTestFile && change.content.includes("console.log(")) {
      warnings.push({
        code: "AST_CONSOLE_LOG",
        message: `File \`${change.file}\` contains console.log — remove before shipping`,
        file: change.file,
      })
    }

    // ── data-testid validation for components ────────────────────────────────
    if (isComponent && !isTestFile) {
      // Check all buttons have data-testid
      const buttonCount = (change.content.match(/<Button/g) ?? []).length +
                          (change.content.match(/<button/g) ?? []).length
      const testidCount = (change.content.match(/data-testid=/g) ?? []).length

      if (buttonCount > 0 && testidCount === 0) {
        errors.push({
          code: "AST_MISSING_TESTID",
          message: `Component \`${change.file}\` has buttons/inputs but no data-testid attributes`,
          file: change.file,
        })
      }

      // If design spec exists, validate testid values match spec
      if (designSpec && testidCount > 0) {
        const specTestids = Object.values(designSpec.testids)
        for (const [, specTestid] of Object.entries(designSpec.testids)) {
          if (!change.content.includes(`data-testid="${specTestid}"`)) {
            errors.push({
              code: "AST_TESTID_MISMATCH",
              message: `Component \`${change.file}\` missing data-testid="${specTestid}" from design spec`,
              file: change.file,
            })
          }
        }
      }
    }

    // ── Test file validators ─────────────────────────────────────────────────
    if (isTestFile) {
      // Must use data-testid selectors
      if (change.content.includes(".locator('.") || change.content.includes('.locator(".')){
        errors.push({
          code: "AST_CSS_SELECTOR_IN_TEST",
          message: `Test \`${change.file}\` uses CSS class selectors — use getByTestId() only`,
          file: change.file,
        })
      }

      if (change.content.includes("getByText(") && !change.content.includes("getByTestId(")) {
        warnings.push({
          code: "AST_TEXT_SELECTOR_IN_TEST",
          message: `Test \`${change.file}\` uses text selectors — prefer getByTestId()`,
          file: change.file,
        })
      }

      // Must have afterEach or afterAll cleanup
      if (
        change.content.includes("createTestUser") &&
        !change.content.includes("afterEach") &&
        !change.content.includes("afterAll")
      ) {
        errors.push({
          code: "AST_MISSING_CLEANUP",
          message: `Test \`${change.file}\` creates test data but has no afterEach cleanup`,
          file: change.file,
        })
      }

      // Must not hardcode credentials
      if (
        change.content.match(/password['":\s]+=?\s*['"](?!process\.env)[^'"]{4,}['"]/i)
      ) {
        errors.push({
          code: "AST_HARDCODED_CREDENTIALS",
          message: `Test \`${change.file}\` appears to hardcode credentials — use process.env`,
          file: change.file,
        })
      }
    }
  }

  return { errors, warnings }
}

// ─── Validator 5: Test file presence ─────────────────────────────────────────

function validateTestFile(
  task: Task,
  output: BuilderOutput
): ValidationError[] {
  const errors: ValidationError[] = []

  if (!task.test_scope) return errors

  const testFile = task.test_scope.test_file
  const testChange = output.changes.find((c) => c.file === testFile)

  if (!testChange) {
    errors.push({
      code: "TEST_FILE_MISSING",
      message: `Required test file \`${testFile}\` not found in builder output. ` +
        `task.test_scope requires a test file covering: ${task.test_scope.critical_paths.join("; ")}`,
    })
    return errors
  }

  if (!testChange.content || testChange.content.trim() === "") {
    errors.push({
      code: "TEST_FILE_EMPTY",
      message: `Test file \`${testFile}\` is empty`,
      file: testFile,
    })
    return errors
  }

  // Check each critical path has a test case
  for (const criticalPath of task.test_scope.critical_paths) {
    // Extract key nouns from the critical path description to check coverage
    const keywords = criticalPath
      .toLowerCase()
      .split(" ")
      .filter((w) => w.length > 4 && !["with", "from", "that", "when", "then", "should"].includes(w))
      .slice(0, 3)

    const covered = keywords.some((kw) =>
      testChange.content.toLowerCase().includes(kw)
    )

    if (!covered) {
      errors.push({
        code: "TEST_MISSING_COVERAGE",
        message: `Test \`${testFile}\` may not cover critical path: "${criticalPath}"`,
        file: testFile,
      })
    }
  }

  return errors
}
