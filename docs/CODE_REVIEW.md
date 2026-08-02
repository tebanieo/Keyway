# Keyway — Pre-Open-Source Deep Review

_Reviewed: full `src/` (engine, model, 3 React components), configs, all 12 test suites (116 tests, green), `package.json`/lockfile, `index.html`. Findings below were cross-checked against the source; items marked **[verified]** were re-confirmed by hand._

**Nothing in this review has been applied.** It's a read-first report; fixes await your go-ahead. This file itself is an internal artifact — prune it (and `REVIEW.md`, see B2) before the public release.

---

## Executive verdict

| Axis | Verdict |
|---|---|
| **Security / egress** | ✅ The "nothing leaves the browser" claim is **TRUE** [verified]. No active vulnerabilities; two low hardening items. |
| **Dependencies** | ✅ Shipped bundle is **clean** [verified]. All 5 audit vulns are **dev/build-only** (Vitest tree); one clean fix. |
| **Architecture** | ✅ Layering is genuinely clean (one-way UI→model→engine, no cycles, pure core). Weak point: `App.tsx` is a god-component. |
| **Quality** | ✅ Above the open-source bar. Strict TS with no escape hatches, why-comments, strong test core. Blockers are administrative. |

**Overall:** the pure-core-plus-thin-shell design, strict typing (no `any`/`@ts-ignore`), and a well-asserted 116-test core are strong. The two blockers are paperwork (license, remove an internal scratchpad). The only real correctness smells are the multi-key diff ordering (S2) and a number-vs-`attribute_type` contradiction in the filter (S3).

---

## What's excellent (so the report is balanced)

- **Pure core.** `engine/` and `model/` are DOM/React/async-free and deterministic; every pure fn says so and is. This is what makes the codebase trustworthy.
- **TypeScript rigor.** `strict`, `noUnusedLocals`, `noUnusedParameters`, `noFallthroughCasesInSwitch`, `verbatimModuleSyntax` all on. Whole-tree grep: **no `any`, no `@ts-ignore`, no `as any`** — only 3 narrow token→union casts.
- **Domain modeling.** `Op`/`WriteAction`, `FilterNode`, `CoverageStatus`, `IndexEffect` are discriminated unions consumed with exhaustive switches (compiler-enforced totality).
- **Comments explain WHY** (KEY_SEP=NUL rationale, transactional 2× billing, `docVersion` remount, sparse-index-for-free).
- **React idioms.** Textbook uncontrolled-CodeMirror (mount-once, `cb.current` ref, `key={docVersion}` remount, `view.destroy()` cleanup); every effect has a correct dep array + cleanup; derived state is `useMemo`, not mirrored into `useState`.
- **Test quality.** Assertions teach the invariant; multi-key grouping/sort, sparse exclusion, all projection modes, transact billing, filter precedence, and serialize→parse round-trip are covered.

---

## BLOCKERS (must clear before publishing)

- **B1 — No license.** [verified] No `LICENSE` file and no `license` field in `package.json` (still `"private": true`). Without one, default is "all rights reserved" — you cannot open-source. Add a `LICENSE` (MIT/Apache-2.0) + set the field.
- **B2 — `REVIEW.md` is a tracked internal scratchpad.** [verified — it's in `git ls-files`] Stale ("75 unit tests"; repo has 116), reads as private notes, advertises an unfixed bug. Delete or gitignore before publishing. (Same goes for this file.)

---

## 1. Security / data-egress  ✅ claim holds

**Verdict: TRUE — no code path transmits data off-device.** [verified by grep + read]
- No `fetch`/`XHR`/`WebSocket`/`sendBeacon`, no analytics, no external `<script>`/`<img>`/CDN. Fonts self-hosted via `@fontsource` (relative `./files/*.woff2` only).
- Share rides in the URL **fragment** (`share.ts` `#m=`) — fragments are never sent to servers. Clipboard writes are local + user-initiated.
- No `eval`/`new Function`/`innerHTML`/`dangerouslySetInnerHTML`/`document.write`. React escapes all rendered DSL/filter text.
- Parsers are hand-written and bounded — no catastrophic-backtracking regex; the `PAIR` regex is polynomial worst-case but capped by `SAFE_URL_LEN=8000` + human-sized editor input. Filter parse errors are caught (`filter.ts` try/catch), so no crash-hang.
- `localStorage` holds only `dc-theme` — no model data, no PII, no secrets.

**Hardening (low, not active vulns):**
- **SEC1 — Prototype-key hygiene** [verified]. `parseAttrs` (`dsl.ts`) and the filter's attr lookup (`filter.ts`) write/read user-named keys on a plain `{}`; `__proto__`/`constructor` are valid `\w+` keys. Not exploitable today (string values, no object-merge), but use `Object.create(null)` for the attrs map to kill the latent trap — matters if parsing ever moves server-side.
- **SEC2 — No CSP.** Fine for a static no-egress app, but a strict `Content-Security-Policy` (`default-src 'self'; connect-src 'none'`) makes the guarantee enforceable/regression-proof. Becomes important once a backend exists.

**Future trust boundaries (when a backend lands):** route all network through a single `src/api/` module (makes no-egress a one-file audit + a lint/test assertion); keep `share.ts` fragment-based as the private default (server-side sharing = model DSL, which may hold real PII, starts leaving the browser — must be explicit/consented); if DSL/filter parsing ever runs server-side, enforce input-length caps and treat every key/value as hostile; keep any future auth tokens out of `localStorage`.

---

## 2. Dependencies / supply chain  ✅ shipped tree clean

**All 5 `npm audit` vulns are dev/build-only** [verified via `npm audit`] — they trace to Vitest's **nested older** copies of vite/esbuild. The top-level vite (6.4.3) / esbuild (0.25.x) that build the app are already patched.

| Package | Sev | Prod/Dev | Note |
|---|---|---|---|
| esbuild (nested 0.21.5) | moderate | **dev** | dev-server request advisory; only while a dev server listens |
| vite (nested 5.4.21) | high | **dev** | `server.fs.deny` bypass etc. |
| @vitest/mocker, vite-node | moderate | **dev** | via vulnerable vite |
| vitest (2.1.9, direct devDep) | critical | **dev** | Vitest **UI** RCE — only with `--ui`, which your scripts never run |

- **Fix (one command, dev-only, breaking):** `npm install -D vitest@^4.1.10` then re-run tests. `npm audit fix` (non-force) does **nothing** here.
- **No unused deps** [verified] — no `motion`/framer-motion anywhere; every dep is imported.
- Caret `^` ranges + **committed lockfile** → reproducible via `npm ci` (which ignores ranges). Recommend CI uses `npm ci` + `npm audit --omit=dev` (would report 0 — proves the shipped tree is clean).
- **Minor:** `@fontsource` per-weight imports pull *all* Unicode subsets (cyrillic/greek/…). Switch to `latin-<weight>.css` to trim shipped font bytes.

---

## 3. Architecture / modularity  ✅ clean layers, one god-component

**Layering is real:** `engine/` imports only `engine/` (leaf); `model/` imports only `engine/`; UI imports both. One-way, no cycles, engine is truly pure. This is the strong point.

**A1 — `App.tsx` (1293 lines) is a god-component.** 26 `useState`, 10 inline components (`Icon`/`Logo`/`Drawer`/`RightRail`/`AccessPatterns`/`ExamplesDrawer`/`CostBar`/`Panel`/`GridRows`/`EditableCell`), plus pure op-logic. Staged decomposition (each step ships independently, tests stay green):
- **Phase 1 (pure lifts, S):** `model/actions.ts` ← `editToOps`, `nextItemLabel`, `describe`, `keyLabel`; add `serializeModel(...)` to `dsl.ts` (replaces the per-render `modelToText`); `model/view.ts` ← `unionKeys`/`isKeyAttr`/`projLabel`.
- **Phase 2 (extract leaf components, S–M):** `components/icons.tsx`, `components/CostBar.tsx`, `components/Panel.tsx` (the ~230-line diff-grid, highest value), `components/rail/*`, `components/Toolbar.tsx`.
- **Phase 3 (hooks — the real decoupling, L then S):** `hooks/useModel.ts` (ops/doc/base/gsis/aps/step + producers + projection `useMemo`s), `hooks/usePlayback.ts`, `hooks/useTheme.ts`. After this, App is a ~150-line composition root.

**A2 — Business logic embedded in the UI file.** `editToOps` (key-change → atomic transact), `nextItemLabel`, `describe`/`keyLabel`, `unionKeys`/`isKeyAttr` are pure engine/model concerns living in `App.tsx`. Lift into `model/` (also unlocks unit tests — see N1).

**A3 — `share.ts` reads global `location`** (`shareUrl`), making the otherwise-pure model layer browser-bound. Have it take `origin`/`pathname` params; read `location` in App. (S)

**A4 — Duplicated logic** (each S): attr-change detection (`diff.ts:attrsDiffer` vs `cost.ts` ALL-branch); sort-by-(sortkeys, id) implemented twice (`engine.ts` vs `diff.ts` — also the S2 bug); "find the put in an op" open-coded in `dsl.ts`/`App.tsx`/`cost.ts` though `backfill.ts:putItemOf` exists — reuse it.

**A5 — No barrel exports.** Add `engine/index.ts` + `model/index.ts` so UI imports read `from "./engine"` and the layer boundary is explicit. (S)

---

## 4. Code quality — should-fix + nice-to-have

**SHOULD-FIX**
- **S1 — `seed.ts` is misnamed dead scaffolding** [verified]. `SEED_OPS`/`GSI1_INDEX`/`INDEXES` are unreferenced (only a doc-comment mention in `doc.ts`); the sole live export is `BASE_INDEX`. Delete the dead exports and move `BASE_INDEX` to a `constants.ts` (the DSL/`doc.ts` is the real seed now). ~110 lines dead.
- **S2 — Diff row ordering ignores multi-attribute sort keys** [verified — this is a real bug]. `diff.ts:sortKey` sorts by the scalar `index.sk` (first sort attr only); `engine.ts:project` sorts by the full `skAttrs` tuple. On a **multi-key GSI with Diff on (default)**, rows re-order vs Diff off. Narrow (multi-key only) and cosmetic (ordering), but real. Fix: `bySortKey` iterates `skAttrs(index)` like `project` (ideally one shared comparator).
- **S3 — Filter comparison contradicts `attribute_type`** [verified]. `compare` (`filter.ts:278`) sniffs numeric-looking strings and compares them **numerically**, but `attribute_type` (`filter.ts:322`) reports **every** attribute as `"S"`. So the teaching tool says `total` is a String yet orders it as a Number (real DynamoDB would compare `"10" < "9"` lexically). Document the divergence, or make comparison lexical to match the declared type — until real `N` typing lands (already backlogged).
- **S4 — `aria-hidden` on a container with focusable children** [verified — `Drawer` sets `aria-hidden={!open}` but renders its buttons regardless]. A hidden element with tabbable descendants is a WCAG failure. Use `inert` when closed, or don't render the body when `!open`.

**NICE-TO-HAVE**
- **N1 — Zero component/UI tests.** No `.test.tsx`. The untested `App.tsx` helpers (`editToOps`, `nextItemLabel`, `unionKeys`, `describe`) become unit-testable once lifted to `model/` (A2). Optionally add a couple of `@testing-library/react` smoke tests for the `commit`/`onDoc` flows.
- **N2 — `size()` filter uses UTF-16 length, not UTF-8 bytes** [verified — `filter.ts:273` `String(v.length)`]. DynamoDB `size()` on a String is byte length; reuse `itemsize.ts:utf8Len`.
- **N3 — Stepper icon buttons rely on `title` alone.** Rail/theme buttons carry `aria-label`; prev/play/next don't, and their `<Icon>` SVGs aren't `aria-hidden`. Add for consistency.
- **N4 — Known editor completion bug (backlogged).** The `item` snippet attribute slot can double a value (`_type=x=value`); `completeDsl` mitigates the value-typing case but not the snippet-field case. Worth a test + fix given the editor is a headline feature.
- **N5 — `get` AP with a missing SK grades "empty" not "incomplete"** (`coverage.ts` fills `""` for absent SK attrs → silent miss). Slightly misleading for the teaching goal.
- **N6 — O(n) linear scans** (`cost.ts:findById`, `engine.ts` delete-by-id) despite the O(changes) framing. Fine at toy scale; note if models grow.
- **N7 — `ReadMode` "transactional" is a dead branch** (`itemsize.ts`/`rcu` handle it; `runQuery` only passes strong/eventual).
- **N8 — [NOT REPRODUCED]** An agent flagged `.claude/settings.local.json` as tracked; `git ls-files` shows it is **not** tracked. No action.

---

## Prioritized action list

| # | Item | Axis | Sev | Effort | Where |
|---|---|---|---|---|---|
| 1 | Add `LICENSE` + `package.json` license field | quality | **blocker** | S | repo root |
| 2 | Remove/gitignore `REVIEW.md` (+ this file) | quality | **blocker** | S | `REVIEW.md` |
| 3 | Fix multi-key diff sort (`skAttrs` + shared comparator) | arch/correctness | should | S | `diff.ts:88-100` |
| 4 | Filter number-vs-`attribute_type` divergence (doc or fix) | quality/correctness | should | S–M | `filter.ts:278,322` |
| 5 | `aria-hidden` drawer → `inert`/conditional render | quality/a11y | should | S | `App.tsx` `Drawer` |
| 6 | Delete dead `seed.ts` exports; move `BASE_INDEX` | arch | should | S | `model/seed.ts` |
| 7 | `Object.create(null)` for parsed attrs (proto hygiene) | security | low | S | `dsl.ts`, `filter.ts` |
| 8 | Add strict CSP meta / headers | security | low | S | `index.html` |
| 9 | Bump `vitest@^4` (clears all 5 audit vulns) | deps | low | S | `package.json` |
| 10 | Lift pure logic out of `App.tsx` into `model/` + hooks | arch | — | L | `App.tsx` |
| 11 | Extract inline components into `components/` | arch | — | M | `App.tsx` |
| 12 | De-dupe attr-change/sort/`putItemOf`; add barrels | arch | — | S | multiple |
| 13 | `size()` UTF-8; stepper a11y; font subsets; CI `npm ci`+audit | mixed | nice | S | multiple |

**Bottom line:** ship-worthy engineering. Clear the two administrative blockers, land the two real correctness fixes (S2, S3), and the rest is polish you can sequence at leisure. The App.tsx decomposition is the biggest structural investment but is pure extraction — the layers are already correct.
