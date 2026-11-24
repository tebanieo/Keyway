#!/usr/bin/env node
// Claude Code PreToolUse guard (wired in .claude/settings.json). It refuses any
// command that would skip or disable the Lefthook pre-commit gate, and any
// commit made while that gate isn't installed. Exit code 2 blocks the tool
// call and hands the reason back to the agent. CI runs the same checks as the
// backstop for anything that doesn't go through an agent.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const RULES = [
  // git accepts any unambiguous abbreviation of a long option (--no-veri…).
  [/--no-veri(?:fy?)?\b/, "`--no-verify` skips the pre-commit gate"],
  [/\bcommit\b[^;&|]*\s-[a-zA-Z]*n[a-zA-Z]*(\s|$)/, "`git commit -n` skips the pre-commit gate"],
  [/\bLEFTHOOK(_SKIP|_EXCLUDE)?=/, "LEFTHOOK env vars disable or narrow the pre-commit gate"],
  // git config keys are case-insensitive.
  [/\bhookspath\b/i, "changing core.hooksPath bypasses the installed hooks"],
  [/\blefthook\s+uninstall\b/, "uninstalling Lefthook removes the pre-commit gate"],
];

// Any command that names the hooks directory must be a plain read: anything
// else (sed -i, python, a redirect, ...) could rewrite the hook.
const HOOKS_DIR = /\.git\/hooks\b/;
const READ_ONLY = /^\s*(ls|cat|head|tail|stat|file|wc|test|\[)\b[^;&|<>`$()]*$/;

/**
 * Drop text that is data rather than shell: commit-message arguments and
 * heredoc bodies, so a message that merely mentions `--no-verify` isn't refused.
 */
function stripMessages(command) {
  return command
    .replace(/<<-?\s*(['"]?)(\w+)\1[\s\S]*?\n\s*\2\b/g, "<<heredoc")
    .replace(/(\s(?:-m|--message)(?:=|\s+))("(?:[^"\\]|\\[\s\S])*"|'[^']*')/g, "$1msg");
}

/** Why `command` must be refused, or null when it's fine. */
export function check(rawCommand, repoDir) {
  const command = stripMessages(rawCommand);
  for (const [pattern, reason] of RULES) {
    if (pattern.test(command)) return reason;
  }
  if (HOOKS_DIR.test(command) && !READ_ONLY.test(command)) {
    return "modifying .git/hooks tampers with the pre-commit gate";
  }
  if (/\bgit\b[^;&|]*\bcommit\b/.test(command) && repoDir) {
    if (!existsSync(preCommitHook(repoDir))) {
      return "the Lefthook pre-commit hook isn't installed; run `npm install` first";
    }
  }
  return null;
}

/** Where git looks for the pre-commit hook (a worktree's `.git` is a file). */
function preCommitHook(repoDir) {
  try {
    const p = execFileSync("git", ["rev-parse", "--git-path", "hooks/pre-commit"], {
      cwd: repoDir,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return resolve(repoDir, p); // git answers relative, or absolute in a worktree
  } catch {
    return join(repoDir, ".git", "hooks", "pre-commit");
  }
}

/** Why a file write must be refused, or null when it's fine. */
export function checkPath(filePath) {
  return /(^|\/)\.git\/hooks(\/|$)/.test(filePath ?? "")
    ? "modifying .git/hooks tampers with the pre-commit gate"
    : null;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const input = JSON.parse(readFileSync(0, "utf8") || "{}");
  const tool = input.tool_input ?? {};
  const repoDir = process.env.CLAUDE_PROJECT_DIR ?? input.cwd ?? process.cwd();
  const reason =
    typeof tool.command === "string" ? check(tool.command, repoDir) : checkPath(tool.file_path);
  if (reason) {
    process.stderr.write(
      `Blocked: ${reason}. The pre-commit gate (format, lint, typecheck, tests) ` +
        `must run on every commit in this repo. Fix what it reports instead.\n`,
    );
    process.exit(2);
  }
}
