import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { check, checkPath } from "./guard-git.mjs";

function repo(withHook) {
  const dir = mkdtempSync(join(tmpdir(), "guard-"));
  mkdirSync(join(dir, ".git", "hooks"), { recursive: true });
  if (withHook) writeFileSync(join(dir, ".git", "hooks", "pre-commit"), "");
  return dir;
}

describe("guard-git", () => {
  const ok = repo(true);

  it.each([
    'git commit --no-verify -m "x"',
    'git commit -n -m "x"',
    'git commit -nm "x"',
    "git commit --amend -n",
    "git push --no-verify",
    'LEFTHOOK=0 git commit -m "x"',
    'LEFTHOOK_EXCLUDE=test git commit -m "x"',
    "git config core.hooksPath /dev/null",
    'git -c core.hooksPath=/tmp commit -m "x"',
    "npx lefthook uninstall",
    "rm -f .git/hooks/pre-commit",
    "echo '' > .git/hooks/pre-commit",
    'git commit -m "x" --no-verify',
    "bash -c 'git commit --no-verify'",
  ])("blocks %s", (cmd) => {
    expect(check(cmd, ok)).not.toBeNull();
  });

  it.each([
    'git commit -m "feat: add things"',
    'git commit -am "fix"',
    "git commit --amend --no-edit",
    "git status && git diff",
    "ls .git/hooks",
    "npm test",
    'git commit -m "docs: never use --no-verify or -n"',
    "git commit -m 'block LEFTHOOK=0 and core.hooksPath'",
    "git commit -F - <<'EOF'\nchore: refuse --no-verify\nEOF",
  ])("allows %s", (cmd) => {
    expect(check(cmd, ok)).toBeNull();
  });

  it("blocks commits while the hook isn't installed", () => {
    expect(check('git commit -m "x"', repo(false))).toMatch(/npm install/);
    expect(check("git status", repo(false))).toBeNull();
  });

  it("blocks file writes into .git/hooks", () => {
    expect(checkPath("/repo/.git/hooks/pre-commit")).not.toBeNull();
    expect(checkPath("/repo/src/App.tsx")).toBeNull();
  });
});
