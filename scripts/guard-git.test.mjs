import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { check, checkPath } from "./guard-git.mjs";

// Inside a git hook (Lefthook runs these tests on commit), git exports
// GIT_DIR, GIT_INDEX_FILE and friends, which would point the throwaway repos
// below at the REAL repository. Clear them for this test file.
for (const k of Object.keys(process.env)) if (k.startsWith("GIT_")) delete process.env[k];

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
    'git commit --no-verif -m "x"',
    'git commit --no-veri -m "x"',
    'git -c core.hookspath=/dev/null commit -m "x"',
    "git config Core.HooksPath /tmp",
    "sed -i 's/npx/true/' .git/hooks/pre-commit",
    'python3 -c \'open(".git/hooks/pre-commit","w")\'',
    "cat .git/hooks/pre-commit > /tmp/x && rm .git/hooks/pre-commit",
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
    "cat .git/hooks/pre-commit",
    "git commit --no-verbose -m 'x'",
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

  it("finds the hook where git keeps it, including from a worktree", () => {
    const main = mkdtempSync(join(tmpdir(), "guard-main-"));
    const git = (...args) => execFileSync("git", args, { cwd: main, stdio: "ignore" });
    git("init", "-q");
    git("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", "i");
    const tree = join(main, "..", `${main.split("/").pop()}-wt`);
    git("worktree", "add", "-q", tree);
    // no hook yet: refused from the worktree too (its .git is a file)
    expect(check('git commit -m "x"', tree)).toMatch(/npm install/);
    writeFileSync(join(main, ".git", "hooks", "pre-commit"), "");
    expect(check('git commit -m "x"', tree)).toBeNull();
    expect(check('git commit -m "x"', main)).toBeNull();
  });

  it("blocks file writes into .git/hooks", () => {
    expect(checkPath("/repo/.git/hooks/pre-commit")).not.toBeNull();
    expect(checkPath("/repo/src/App.tsx")).toBeNull();
  });
});
