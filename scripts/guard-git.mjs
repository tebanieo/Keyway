#!/usr/bin/env node
// Claude Code PreToolUse guard (wired in .claude/settings.json). It refuses any
// command that would skip or disable the Lefthook pre-commit gate, and any
// commit made while that gate isn't installed. Exit code 2 blocks the tool
// call and hands the reason back to the agent. CI runs the same checks as the
// backstop for anything that doesn't go through an agent.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const RULES = [
  [/--no-verify\b/, "`--no-verify` skips the pre-commit gate"],
  [/\bcommit\b[^;&|]*\s-[a-zA-Z]*n[a-zA-Z]*(\s|$)/, "`git commit -n` skips the pre-commit gate"],
  [/\bLEFTHOOK(_SKIP|_EXCLUDE)?=/, "LEFTHOOK env vars disable or narrow the pre-commit gate"],
  [/\bhooksPath\b/, "changing core.hooksPath bypasses the installed hooks"],
  [/\blefthook\s+uninstall\b/, "uninstalling Lefthook removes the pre-commit gate"],
  [
    /\b(rm|mv|cp|ln|chmod|truncate|tee)\b[^;&|]*\.git\/hooks|>\s*\S*\.git\/hooks/,
    "modifying .git/hooks tampers with the pre-commit gate",
  ],
];

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
  if (/\bgit\b[^;&|]*\bcommit\b/.test(command) && repoDir) {
    if (!existsSync(join(repoDir, ".git", "hooks", "pre-commit"))) {
      return "the Lefthook pre-commit hook isn't installed; run `npm install` first";
    }
  }
  return null;
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
