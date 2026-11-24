# Agent rules for Keyway

- **Never skip the pre-commit gate.** Lefthook runs format, lint, typecheck,
  and tests on every commit. Don't pass `--no-verify`/`-n`, set `LEFTHOOK*`
  variables, change `core.hooksPath`, or touch `.git/hooks`. If a check fails,
  fix the cause. If the hook isn't installed, run `npm install`. A Claude Code
  hook (`scripts/guard-git.mjs`) enforces this, and CI re-runs the gate on
  every push.
- **The human is the author.** Commit as the repo owner's git identity; agents
  credit themselves only with a `Co-Authored-By:` trailer.
- **Micro-commits**, each with a `CHANGELOG.md` entry under `[Unreleased]`
  when it's user-visible.
- Read `README.md` first: Keyway is 100% client-side and privacy-first; never
  add network calls that carry the user's model.
