import { execa } from "execa"
import os from "os"
import path from "path"

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

// ─── Worktree isolation ───────────────────────────────────────────────────────

export async function createWorktree(id: string): Promise<string> {
  const worktreePath = path.join(os.tmpdir(), `agent-worktree-${id}-${Date.now()}`)
  const branchName = `agent/wt-${id}-${Date.now()}`
  await execa("git", ["worktree", "add", "-b", branchName, worktreePath])
  return worktreePath
}

export async function removeWorktree(worktreePath: string): Promise<void> {
  await execa("git", ["worktree", "remove", "--force", worktreePath], { reject: false })
  await execa("git", ["worktree", "prune"], { reject: false })
}

export async function commitInWorktree(worktreePath: string, message: string): Promise<string> {
  await execa("git", ["-C", worktreePath, "add", "."])
  const { exitCode } = await execa(
    "git", ["-C", worktreePath, "diff", "--cached", "--quiet"],
    { reject: false }
  )
  if (exitCode !== 1) return "" // nothing staged
  await execa("git", ["-C", worktreePath, "commit", "-m", message])
  const { stdout } = await execa("git", ["-C", worktreePath, "rev-parse", "HEAD"])
  return stdout.trim()
}

export async function getDiffFromWorktree(worktreePath: string): Promise<string> {
  try {
    const { stdout } = await execa("git", ["-C", worktreePath, "show", "HEAD", "--stat", "-p"])
    return stdout
  } catch {
    return ""
  }
}

export async function cherryPickToMain(commitSha: string): Promise<void> {
  if (!commitSha) return
  await execa("git", ["cherry-pick", "--no-edit", commitSha])
}

export async function hasUncommittedChanges(): Promise<boolean> {
  const { stdout } = await execa("git", ["status", "--porcelain"])
  return stdout.trim().length > 0
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
