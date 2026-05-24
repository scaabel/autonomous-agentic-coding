import fs from "fs-extra"
import path from "path"
import { fileURLToPath } from "url"
import { execa } from "execa"
import chalk from "chalk"
import ora from "ora"
import { askYesNo, waitForEnter } from "../utils/input.js"
import { writeConfig, CONFIG_DEFAULTS } from "../core/config.js"

// ─── Types ────────────────────────────────────────────────────────────────────

type Framework = "next" | "express" | "fastify" | "remix" | "vite" | "generic"
type Language  = "ts" | "js"
type PackageManager = "npm" | "pnpm" | "bun" | "yarn"

type ProjectContext = {
  framework: Framework
  language: Language
  packageManager: PackageManager
  srcDir: string
  hasGit: boolean
  hasTailwind: boolean
  hasPrisma: boolean
  hasExistingComponents: boolean
  existingComponentPaths: string[]
  existingHookPaths: string[]
  protectedFiles: string[]
  appRouterNext: boolean
}

// ─── Main entry ───────────────────────────────────────────────────────────────

export async function init(options: { scanExisting: boolean; yes: boolean }): Promise<void> {
  const projectRoot = process.cwd()
  const packageRoot = resolvePackageRoot()

  console.log(chalk.bold.cyan("\n┌─────────────────────────────────────┐"))
  console.log(chalk.bold.cyan("│      🧠 Agent System — Init         │"))
  console.log(chalk.bold.cyan("└─────────────────────────────────────┘\n"))

  // ── Step 1: Detect project ─────────────────────────────────────────────────
  const detectSpinner = ora("  Detecting project...").start()
  const ctx = await detectProject(projectRoot)
  detectSpinner.succeed(
    chalk.green(
      `  Detected: ${ctx.framework === "generic" ? "No framework" : ctx.framework} | ` +
      `${ctx.language === "ts" ? "TypeScript" : "JavaScript"} | ` +
      `${ctx.packageManager}`
    )
  )

  // ── Step 2: Check if already initialised ──────────────────────────────────
  const agentDir = path.join(projectRoot, ".agent")
  if (await fs.pathExists(path.join(agentDir, "config.json"))) {
    if (!options.yes) {
      const overwrite = await askYesNo(
        chalk.yellow("  .agent/ already exists. Re-initialise?")
      )
      if (!overwrite) {
        console.log(chalk.dim("  Skipped.\n"))
        return
      }
    }
  }

  // ── Step 3: Create .agent/ workspace ──────────────────────────────────────
  const workspaceSpinner = ora("  Creating .agent/ workspace...").start()
  await fs.ensureDir(path.join(agentDir, "mockups"))
  await fs.ensureDir(path.join(agentDir, "traces"))
  workspaceSpinner.succeed(chalk.green("  .agent/ workspace created"))

  // ── Step 3b: Detect monorepo ───────────────────────────────────────────────
  const { detectMonorepoWorkspaces } = await import("../core/workspace.js")
  const detectedWorkspaces = await detectMonorepoWorkspaces(projectRoot)
  const isMonorepoProject = detectedWorkspaces.length > 1

  let workspacesConfig: Record<string, any> | undefined

  if (isMonorepoProject) {
    console.log(chalk.bold.yellow(`\n  Monorepo detected — ${detectedWorkspaces.length} packages found:\n`))
    detectedWorkspaces.forEach((ws) => {
      console.log(`    ${chalk.cyan(ws.name.padEnd(12))} ${chalk.dim(ws.root)} (${ws.framework})`)
    })
    console.log()

    workspacesConfig = {}
    for (const ws of detectedWorkspaces) {
      workspacesConfig[ws.name] = {
        root: ws.root,
        framework: ws.framework,
        language: ws.language,
        srcDir: "src",
        testDir: ws.agents.includes("fe") ? "e2e" : "tests",
        skillsDir: `.agent/skills/${ws.name}`,
        agents: ws.agents,
      }

      // Scaffold per-workspace skill dirs
      const wsSkillsDir = path.join(agentDir, "skills", ws.name)
      await fs.ensureDir(path.join(wsSkillsDir, "shared"))
      if (ws.agents.includes("be") || ws.agents.includes("both")) {
        await fs.ensureDir(path.join(wsSkillsDir, "be"))
      }
      if (ws.agents.includes("fe") || ws.agents.includes("both")) {
        await fs.ensureDir(path.join(wsSkillsDir, "fe"))
        await fs.ensureDir(path.join(wsSkillsDir, "designer"))
      }

      // Write workspace-specific project skill
      const wsProjectSkill = generateWorkspaceProjectSkill(ws)
      await fs.outputFile(
        path.join(wsSkillsDir, "shared", "project.md"),
        wsProjectSkill,
        "utf-8"
      )

      // Copy framework-specific testing templates if fe workspace
      if (ws.framework === "expo" || ws.framework === "react-native") {
        await copyReactNativeTestingSkill(
          path.join(agentDir, "skills", ws.name, "testing")
        )
      }
    }
  }

  // ── Step 4: Write config ───────────────────────────────────────────────────
  await writeConfig({
    framework:       ctx.framework,
    language:        ctx.language,
    srcDir:          ctx.srcDir,
    docsDir:         "docs",
    tracesDir:       ".agent/traces",
    skillsDir:       ".agent/skills",
    mockupsDir:      ".agent/mockups",
    testDir:         "tests/e2e",
    model:           CONFIG_DEFAULTS.model,
    fastModel:       CONFIG_DEFAULTS.fastModel,
    maxRetries:      CONFIG_DEFAULTS.maxRetries,
    requireApproval: CONFIG_DEFAULTS.requireApproval,
    monthlyBudgetUsd: CONFIG_DEFAULTS.monthlyBudgetUsd,
    ...(workspacesConfig ? { workspaces: workspacesConfig } : {}),
  })
  console.log(chalk.dim("  ✓ .agent/config.json written"))

  // ── Step 5: Copy skills ────────────────────────────────────────────────────
  const skillsSpinner = ora("  Scaffolding skills...").start()
  const sourceSkillsDir = path.join(packageRoot, "skills")
  const destSkillsDir   = path.join(agentDir, "skills")

  await copyNewOnly(sourceSkillsDir, destSkillsDir)
  skillsSpinner.succeed(chalk.green("  .agent/skills/ scaffolded"))

  // ── Step 6: Generate project.md skill from codebase scan ──────────────────
  const projectSkillSpinner = ora("  Scanning project structure...").start()
  const projectSkill = await generateProjectSkill(ctx, projectRoot)
  const projectSkillPath = path.join(destSkillsDir, "shared", "project.md")
  await fs.outputFile(projectSkillPath, projectSkill, "utf-8")
  projectSkillSpinner.succeed(chalk.green("  .agent/skills/shared/project.md generated"))

  // ── Step 7: Scaffold test infrastructure ──────────────────────────────────
  const testSpinner = ora("  Scaffolding tests/e2e/...").start()
  const templatesDir = path.join(packageRoot, "templates", "testing")

  await fs.ensureDir(path.join(projectRoot, "tests", "e2e", "critical-paths"))
  await fs.ensureDir(path.join(projectRoot, "tests", "e2e", "features"))
  await fs.ensureDir(path.join(projectRoot, "tests", "e2e", "fixtures"))
  await fs.ensureDir(path.join(projectRoot, "tests", "e2e", "setup"))

  // Copy template files only if they don't exist yet
  await copyNewOnly(
    path.join(templatesDir, "setup"),
    path.join(projectRoot, "tests", "e2e", "setup")
  )
  await copyNewOnly(
    path.join(templatesDir, "fixtures"),
    path.join(projectRoot, "tests", "e2e", "fixtures")
  )

  // playwright.config.ts — only if not already present
  const playwrightConfigDest = path.join(projectRoot, "playwright.config.ts")
  if (!(await fs.pathExists(playwrightConfigDest))) {
    await fs.copy(path.join(templatesDir, "playwright.config.ts"), playwrightConfigDest)
  }

  // .env.test.example
  const envTestDest = path.join(projectRoot, ".env.test.example")
  if (!(await fs.pathExists(envTestDest))) {
    await fs.copy(path.join(templatesDir, ".env.test.example"), envTestDest)
  }

  testSpinner.succeed(chalk.green("  tests/e2e/ scaffolded"))

  // ── Step 8: Update .gitignore ──────────────────────────────────────────────
  await updateGitignore(projectRoot)
  console.log(chalk.dim("  ✓ .gitignore updated"))

  // ── Step 9: Install Playwright if needed ───────────────────────────────────
  const playwrightInstalled = await checkPackageInstalled("@playwright/test", projectRoot)
  if (!playwrightInstalled) {
    const installPlaywright = options.yes || await askYesNo(
      "  Install @playwright/test? (recommended)"
    )
    if (installPlaywright) {
      const pwSpinner = ora("  Installing @playwright/test...").start()
      try {
        const installCmd = ctx.packageManager === "pnpm" ? "pnpm" :
                           ctx.packageManager === "bun"  ? "bun"  :
                           ctx.packageManager === "yarn" ? "yarn" : "npm"
        const installArgs = ctx.packageManager === "npm"
          ? ["install", "-D", "@playwright/test"]
          : ["add", "-D", "@playwright/test"]
        await execa(installCmd, installArgs, { cwd: projectRoot })
        await execa("npx", ["playwright", "install", "chromium"], { cwd: projectRoot })
        pwSpinner.succeed(chalk.green("  @playwright/test installed"))
      } catch {
        pwSpinner.warn(chalk.yellow("  Could not install @playwright/test — install manually"))
      }
    }
  }

  // ── Step 10: Optional existing project scan ───────────────────────────────
  if (options.scanExisting && ctx.hasExistingComponents) {
    const scanSpinner = ora("  Scanning existing components and hooks...").start()
    await bootstrapRegistryFromExisting(ctx, projectRoot)
    scanSpinner.succeed(
      chalk.green(
        `  Pre-populated registry with ${ctx.existingComponentPaths.length} components, ` +
        `${ctx.existingHookPaths.length} hooks`
      )
    )
  }

  // ── Git init ───────────────────────────────────────────────────────────────
  if (!ctx.hasGit) {
    await execa("git", ["init"], { cwd: projectRoot })
    console.log(chalk.dim("  ✓ git init"))
  }

  // ── Done ───────────────────────────────────────────────────────────────────
  printNextSteps(ctx, workspacesConfig)
}

// ─── Framework detection ──────────────────────────────────────────────────────

async function detectProject(root: string): Promise<ProjectContext> {
  const pkgPath = path.join(root, "package.json")
  let pkg: Record<string, any> = {}
  if (await fs.pathExists(pkgPath)) {
    pkg = await fs.readJSON(pkgPath)
  }

  const deps = { ...pkg.dependencies, ...pkg.devDependencies }

  const framework: Framework =
    deps?.next              ? "next"    :
    deps?.express           ? "express" :
    deps?.fastify           ? "fastify" :
    deps?.["@remix-run/node"] ? "remix" :
    deps?.vite              ? "vite"    :
                              "generic"

  const language: Language =
    (await fs.pathExists(path.join(root, "tsconfig.json"))) ||
    deps?.typescript ? "ts" : "js"

  const packageManager: PackageManager =
    (await fs.pathExists(path.join(root, "pnpm-lock.yaml")))  ? "pnpm" :
    (await fs.pathExists(path.join(root, "bun.lockb")))        ? "bun"  :
    (await fs.pathExists(path.join(root, "yarn.lock")))        ? "yarn" :
                                                                  "npm"

  const hasTailwind  = !!(deps?.tailwindcss || await fs.pathExists(path.join(root, "tailwind.config.ts")) || await fs.pathExists(path.join(root, "tailwind.config.js")))
  const hasPrisma    = !!(deps?.["@prisma/client"] || await fs.pathExists(path.join(root, "prisma")))
  const hasGit       = await fs.pathExists(path.join(root, ".git"))
  const appRouterNext = framework === "next" && (
    await fs.pathExists(path.join(root, "src", "app")) ||
    await fs.pathExists(path.join(root, "app"))
  )

  const hasSrcDir    = await fs.pathExists(path.join(root, "src"))
  const srcDir       = hasSrcDir ? "src" : "."

  // Scan for existing components and hooks
  const existingComponentPaths: string[] = []
  const existingHookPaths: string[] = []
  const uiDir = path.join(root, srcDir, "components", "ui")
  if (await fs.pathExists(uiDir)) {
    const uiFiles = await fs.readdir(uiDir)
    existingComponentPaths.push(
      ...uiFiles
        .filter((f) => f.endsWith(".tsx") || f.endsWith(".jsx"))
        .map((f) => path.join(srcDir, "components", "ui", f))
    )
  }
  const hooksDir = path.join(root, srcDir, "hooks")
  if (await fs.pathExists(hooksDir)) {
    const hookFiles = await fs.readdir(hooksDir)
    existingHookPaths.push(
      ...hookFiles
        .filter((f) => f.startsWith("use") && (f.endsWith(".ts") || f.endsWith(".tsx")))
        .map((f) => path.join(srcDir, "hooks", f))
    )
  }

  const hasExistingComponents = existingComponentPaths.length > 0

  // Protected files — things agents must never modify
  const protectedFiles: string[] = []
  for (const f of [
    "next.config.js", "next.config.ts", "next.config.mjs",
    "tailwind.config.ts", "tailwind.config.js",
    "tsconfig.json", "package.json",
    "src/app/layout.tsx", "app/layout.tsx",
    "src/app/globals.css", "app/globals.css",
    "prisma/schema.prisma",
  ]) {
    if (await fs.pathExists(path.join(root, f))) protectedFiles.push(f)
  }

  return {
    framework, language, packageManager, srcDir,
    hasGit, hasTailwind, hasPrisma, hasExistingComponents,
    existingComponentPaths, existingHookPaths, protectedFiles, appRouterNext,
  }
}

// ─── Project skill generation ─────────────────────────────────────────────────

async function generateProjectSkill(ctx: ProjectContext, root: string): Promise<string> {
  const lines: string[] = ["# Project Context\n"]

  lines.push(`Framework: ${ctx.framework === "generic" ? "None detected" : ctx.framework}`)
  lines.push(`Language: ${ctx.language === "ts" ? "TypeScript" : "JavaScript"}`)
  lines.push(`Package manager: ${ctx.packageManager}`)
  lines.push(`Source dir: ${ctx.srcDir}/`)

  if (ctx.framework === "next") {
    lines.push(`\n## Next.js conventions`)
    lines.push(`Router: ${ctx.appRouterNext ? "App Router" : "Pages Router"}`)
    if (ctx.appRouterNext) {
      lines.push("API routes: src/app/api/[route]/route.ts")
      lines.push("Pages: src/app/[route]/page.tsx")
      lines.push("Always use Server Components by default")
      lines.push("Add 'use client' only when hooks or browser APIs are needed")
    } else {
      lines.push("API routes: pages/api/[route].ts")
      lines.push("Pages: pages/[route].tsx")
    }
  }

  if (ctx.framework === "express" || ctx.framework === "fastify") {
    lines.push(`\n## ${ctx.framework} conventions`)
    lines.push("Routes: src/routes/")
    lines.push("Middleware: src/middleware/")
    lines.push("Controllers: src/controllers/ (if present)")
  }

  if (ctx.hasTailwind) {
    lines.push("\n## Styling")
    lines.push("Uses Tailwind CSS — use utility classes only")
    lines.push("Never write custom CSS for layout or spacing")
  }

  if (ctx.hasPrisma) {
    lines.push("\n## Database")
    lines.push("Uses Prisma ORM")
    lines.push("Schema: prisma/schema.prisma")
    lines.push("DB client: src/lib/db.ts or src/lib/prisma.ts (import from there)")
  }

  if (ctx.existingComponentPaths.length > 0) {
    lines.push("\n## Existing UI components (import — never recreate)")
    ctx.existingComponentPaths.forEach((p) => lines.push(`- ${p}`))
  }

  if (ctx.existingHookPaths.length > 0) {
    lines.push("\n## Existing hooks (import — never recreate)")
    ctx.existingHookPaths.forEach((p) => lines.push(`- ${p}`))
  }

  if (ctx.protectedFiles.length > 0) {
    lines.push("\n## Do not modify (protected project files)")
    ctx.protectedFiles.forEach((f) => lines.push(`- ${f}`))
  }

  lines.push("\n## Agent file scope rules")
  lines.push("- Only modify files explicitly listed in the task's scope")
  lines.push("- Never modify files in the 'Do not modify' list above")
  lines.push("- Never create files outside src/ unless explicitly instructed")

  return lines.join("\n")
}

// ─── Bootstrap registry from existing project ─────────────────────────────────

async function bootstrapRegistryFromExisting(
  ctx: ProjectContext,
  root: string
): Promise<void> {
  const registryDir = path.join(root, "docs", "registry")
  await fs.ensureDir(registryDir)

  // Pre-populate components registry
  const components = ctx.existingComponentPaths.map((filePath) => {
    const name = path.basename(filePath, path.extname(filePath))
    // PascalCase the name
    const componentName = name.charAt(0).toUpperCase() + name.slice(1)
    return {
      name: componentName,
      path: filePath,
      props: {},
      consumes: [],
      task_id: "pre-existing",
    }
  })

  const componentsPath = path.join(registryDir, "components-registry.json")
  if (!(await fs.pathExists(componentsPath))) {
    await fs.writeJSON(componentsPath, { components }, { spaces: 2 })
  }

  // Pre-populate hooks registry
  const hooks = ctx.existingHookPaths.map((filePath) => {
    const name = path.basename(filePath, path.extname(filePath))
    return {
      name,
      path: filePath,
      returns: {},
      task_id: "pre-existing",
    }
  })

  const hooksPath = path.join(registryDir, "hooks-registry.json")
  if (!(await fs.pathExists(hooksPath))) {
    await fs.writeJSON(hooksPath, { hooks }, { spaces: 2 })
  }

  // Init the rest empty
  for (const [file, content] of [
    ["be-registry.json",     { files: [] }],
    ["fe-registry.json",     { files: [] }],
    ["shared-types.json",    { types: [] }],
  ] as const) {
    const dest = path.join(registryDir, file)
    if (!(await fs.pathExists(dest))) {
      await fs.writeJSON(dest, content, { spaces: 2 })
    }
  }
}

// ─── .gitignore update ────────────────────────────────────────────────────────

async function updateGitignore(root: string): Promise<void> {
  const gitignorePath = path.join(root, ".gitignore")
  const marker = "# agent-system"
  const additions = [
    "",
    marker,
    ".agent/traces/",
    ".agent/mockups/",
    "docs/registry/",
    "tests/e2e/fixtures/auth.json",
    ".env.test",
  ].join("\n")

  let existing = ""
  if (await fs.pathExists(gitignorePath)) {
    existing = await fs.readFile(gitignorePath, "utf-8")
  }

  if (!existing.includes(marker)) {
    await fs.appendFile(gitignorePath, additions + "\n")
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function copyNewOnly(src: string, dest: string): Promise<void> {
  if (!(await fs.pathExists(src))) return
  await fs.ensureDir(dest)

  const files = await fs.readdir(src)
  for (const file of files) {
    const srcFile  = path.join(src, file)
    const destFile = path.join(dest, file)
    const stat = await fs.stat(srcFile)

    if (stat.isDirectory()) {
      await copyNewOnly(srcFile, destFile)
    } else if (!(await fs.pathExists(destFile))) {
      await fs.copy(srcFile, destFile)
    }
  }
}

async function checkPackageInstalled(pkg: string, root: string): Promise<boolean> {
  const pkgPath = path.join(root, "package.json")
  if (!(await fs.pathExists(pkgPath))) return false
  const json = await fs.readJSON(pkgPath)
  return !!(json.dependencies?.[pkg] || json.devDependencies?.[pkg])
}

function resolvePackageRoot(): string {
  const currentFile = fileURLToPath(import.meta.url)
  return path.resolve(path.dirname(currentFile), "..", "..")
}

function generateWorkspaceProjectSkill(ws: {
  name: string
  root: string
  framework: string
  language: "ts" | "js"
  agents: string[]
}): string {
  const lines = [
    `# Workspace: ${ws.name}`,
    ``,
    `Root: ${ws.root}`,
    `Framework: ${ws.framework}`,
    `Language: ${ws.language === "ts" ? "TypeScript" : "JavaScript"}`,
    `Agents: ${ws.agents.join(", ")}`,
    ``,
  ]

  if (ws.framework === "expo" || ws.framework === "react-native") {
    lines.push(
      `## React Native / Expo conventions`,
      `- Use React Native core components (View, Text, TouchableOpacity)`,
      `- Styling: NativeWind (className prop) or StyleSheet.create()`,
      `- Navigation: React Navigation — never use <Link> or window.location`,
      `- Screens: src/screens/ — one file per screen`,
      `- Components: src/components/ — reusable UI`,
      `- Hooks: src/hooks/ — custom hooks`,
      `- Never use web-only APIs (localStorage, document, window)`,
      `- Platform checks: Platform.OS === 'ios' | 'android'`,
      ``,
      `## Navigation pattern`,
      `import { useNavigation } from '@react-navigation/native'`,
      `navigation.navigate('ScreenName', { param: value })`,
      ``,
      `## Do not modify`,
      `- app.json`,
      `- app/_layout.tsx (if Expo Router)`,
      `- babel.config.js`,
    )
  } else if (ws.framework === "express" || ws.framework === "fastify") {
    lines.push(
      `## ${ws.framework} conventions`,
      `- Routes: src/routes/ — one file per resource`,
      `- Middleware: src/middleware/`,
      `- Types: src/types/`,
      `- DB client: src/lib/db.ts`,
      ``,
      `## Do not modify`,
      `- src/index.ts (app entry point)`,
      `- src/middleware/error.ts (global error handler)`,
    )
  } else if (ws.framework === "next") {
    lines.push(
      `## Next.js conventions`,
      `- API routes: src/app/api/[route]/route.ts`,
      `- Pages: src/app/[route]/page.tsx`,
      `- Components: src/components/`,
      ``,
      `## Do not modify`,
      `- src/app/layout.tsx`,
      `- next.config.js`,
    )
  }

  lines.push(
    ``,
    `## Agent file scope rules`,
    `- All file paths in tasks are relative to this workspace root (${ws.root})`,
    `- Never create files outside src/ unless explicitly instructed`,
  )

  return lines.join("\n")
}

async function copyReactNativeTestingSkill(destDir: string): Promise<void> {
  await fs.ensureDir(destDir)
  const skillContent = `# E2E Testing — React Native / Expo (Detox or Maestro)

## Framework
This workspace uses React Native. E2E tests use Maestro (simpler setup) or Detox.
Check package.json for which is installed.

## Maestro (if present)
- Tests live in e2e/ as .yaml files
- Use id matchers: id: "register-submit-button"
- accessibilityLabel is the selector equivalent of data-testid in web

## Detox (if present)
- Tests in e2e/ as .test.ts files
- Selectors: element(by.id('testid'))
- testID prop in React Native === data-testid in web

## testID convention (same naming as web)
[feature]-[element]-[variant?]
Examples:
  testID="login-email-input"
  testID="login-submit-button"
  testID="register-error-message"

## Builder rule
Every React Native component MUST include testID on:
- All TextInput components
- All Pressable/TouchableOpacity/Button components
- Error message containers
- Key content views
`
  const destPath = path.join(destDir, "rn-e2e-conventions.md")
  if (!(await fs.pathExists(destPath))) {
    await fs.writeFile(destPath, skillContent, "utf-8")
  }
}

function printNextSteps(
  ctx: ProjectContext,
  workspacesConfig?: Record<string, any>
): void {
  console.log(chalk.bold.green("\n✅ Initialised\n"))
  console.log(chalk.bold("Next steps:\n"))

  console.log(chalk.white("  1. Add your API key to .env:"))
  console.log(chalk.dim("     ANTHROPIC_API_KEY=sk-ant-...\n"))

  if (workspacesConfig) {
    const wsNames = Object.keys(workspacesConfig)
    const feWorkspace = wsNames.find((n) =>
      workspacesConfig[n].agents?.includes("fe") ||
      workspacesConfig[n].agents?.includes("both")
    )
    const wsSkillsPath = feWorkspace
      ? `.agent/skills/${feWorkspace}/fe/design-system.md`
      : ".agent/skills/fe/design-system.md"

    console.log(chalk.white("  2. Edit each workspace's design system skill:"))
    wsNames.forEach((name) => {
      const ws = workspacesConfig[name]
      if (ws.agents?.includes("fe") || ws.agents?.includes("both")) {
        console.log(chalk.dim(`     .agent/skills/${name}/fe/design-system.md`))
      }
    })
    console.log()

    console.log(chalk.white("  3. Review detected workspace context:"))
    wsNames.forEach((name) => {
      console.log(chalk.dim(`     .agent/skills/${name}/shared/project.md`))
    })
    console.log()

    console.log(chalk.white("  4. Fill in critical path placeholders:"))
    wsNames.forEach((name) => {
      const ws = workspacesConfig[name]
      const testDir = ws.testDir ?? "tests/e2e"
      console.log(chalk.dim(`     grep -r '[PLACEHOLDER]' ${ws.root}/${testDir}/critical-paths/`))
    })
    console.log()

    console.log(chalk.white("  5. Run your first feature:"))
    console.log(chalk.cyan(`     agent run "add user authentication"\n`))
    console.log(chalk.dim("  The planner will automatically assign tasks to the right workspace."))
    console.log(chalk.dim("  Mockups: .agent/mockups/[task-id].png\n"))
  } else {
    console.log(chalk.white("  2. Edit your design system skill:"))
    console.log(chalk.dim("     .agent/skills/fe/design-system.md"))
    console.log(chalk.dim("     Replace placeholder colors/fonts with your actual tokens\n"))

    console.log(chalk.white("  3. Fill in critical path placeholders:"))
    console.log(chalk.dim("     grep -r '[PLACEHOLDER]' tests/e2e/critical-paths/\n"))

    if (ctx.framework === "next" || ctx.framework === "express") {
      console.log(chalk.white("  4. Review the detected project context:"))
      console.log(chalk.dim("     .agent/skills/shared/project.md\n"))
    }

    console.log(chalk.white("  5. Run your first feature:"))
    console.log(chalk.cyan(`     agent run "add user authentication"\n`))
    console.log(chalk.dim("  Tip: Drop a mockup image at .agent/mockups/[task-id].png"))
    console.log(chalk.dim("  to give the designer visual reference for that task.\n"))
  }
}
