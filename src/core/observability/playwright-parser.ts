import type { TestResult } from "../failures/types.js"

// ─── Playwright JSON reporter shape (subset we care about) ────────────────────

type PwAttachment = {
  name: string
  contentType: string
  path?: string
}

type PwTestResult = {
  status: "passed" | "failed" | "timedOut" | "skipped" | "interrupted"
  duration: number
  errors: { message?: string; stack?: string }[]
  stdout: { text: string; timestamp: number }[]
  stderr: { text: string; timestamp: number }[]
  attachments: PwAttachment[]
}

type PwTest = {
  status: "expected" | "unexpected" | "flaky" | "skipped"
  results: PwTestResult[]
}

type PwSpec = {
  title: string
  file: string
  tests: PwTest[]
}

type PwSuite = {
  title: string
  file?: string
  suites?: PwSuite[]
  specs?: PwSpec[]
}

type PwReport = {
  suites: PwSuite[]
  stats?: {
    duration: number
    expected: number
    unexpected: number
    flaky: number
    skipped: number
  }
}

export type ParsedPlaywrightReport = {
  testResults: TestResult[]
  screenshots: string[]
  traces: string[]
  stats: {
    total: number
    passed: number
    failed: number
    skipped: number
    durationMs: number
  }
}

// ─── Parser ───────────────────────────────────────────────────────────────────

export function parsePlaywrightReport(raw: unknown): ParsedPlaywrightReport {
  const report = raw as PwReport
  const testResults: TestResult[] = []
  const screenshots: string[] = []
  const traces: string[] = []

  for (const suite of report.suites ?? []) {
    collectSuite(suite, "", testResults, screenshots, traces)
  }

  const passed  = testResults.filter((t) => t.status === "passed").length
  const failed  = testResults.filter((t) => t.status === "failed" || t.status === "timed_out").length
  const skipped = testResults.filter((t) => t.status === "skipped").length

  return {
    testResults,
    screenshots,
    traces,
    stats: {
      total:      testResults.length,
      passed,
      failed,
      skipped,
      durationMs: report.stats?.duration ?? 0,
    },
  }
}

function collectSuite(
  suite: PwSuite,
  parentTitle: string,
  testResults: TestResult[],
  screenshots: string[],
  traces: string[]
): void {
  const title = parentTitle ? `${parentTitle} > ${suite.title}` : suite.title

  for (const spec of suite.specs ?? []) {
    const primary = spec.tests[0]?.results[0]
    if (!primary) continue

    const test = spec.tests[0]

    let status: TestResult["status"]
    if (test.status === "skipped") {
      status = "skipped"
    } else if (primary.status === "timedOut") {
      status = "timed_out"
    } else if (test.status === "expected") {
      status = "passed"
    } else {
      status = "failed"
    }

    // Full error: message + stack (not just message)
    const err = primary.errors[0]
    const errorText = err
      ? [err.message, err.stack].filter(Boolean).join("\n")
      : undefined

    testResults.push({
      name:       `${title} > ${spec.title}`,
      status,
      durationMs: primary.duration,
      error:      errorText,
      file:       spec.file || suite.file,
    })

    // Collect attachment paths by content type
    for (const att of primary.attachments ?? []) {
      if (!att.path) continue
      if (att.contentType === "image/png" || att.contentType === "image/jpeg") {
        screenshots.push(att.path)
      } else if (att.name === "trace" || att.path.endsWith(".zip")) {
        traces.push(att.path)
      }
    }
  }

  for (const child of suite.suites ?? []) {
    collectSuite(child, title, testResults, screenshots, traces)
  }
}
