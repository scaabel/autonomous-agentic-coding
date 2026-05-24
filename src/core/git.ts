import { execa } from "execa"

export async function gitAdd(): Promise<void> {
  await execa("git", ["add", "."])
}

export async function gitCommit(message: string): Promise<void> {
  await execa("git", ["add", "."])
  const { exitCode } = await execa("git", ["diff", "--cached", "--quiet"], { reject: false })
  // exitCode 1 means there are staged changes
  if (exitCode === 1) {
    await execa("git", ["commit", "-m", message])
  }
}

/**
 * Returns the diff of the most recent commit.
 * Safe to call after the very first commit (uses git show HEAD).
 */
export async function getDiff(): Promise<string> {
  try {
    const { stdout } = await execa("git", ["show", "HEAD", "--stat", "-p"])
    return stdout
  } catch {
    // No commits yet
    return ""
  }
}

export async function isGitRepo(): Promise<boolean> {
  try {
    await execa("git", ["rev-parse", "--git-dir"])
    return true
  } catch {
    return false
  }
}

export async function initGitRepo(): Promise<void> {
  await execa("git", ["init"])
  await execa("git", ["commit", "--allow-empty", "-m", "chore: init agent-system run"])
}
