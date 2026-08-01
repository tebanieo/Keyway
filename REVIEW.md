# Nightly build — ready for revision

Each feature below is **committed and self-tested (typecheck + build + unit tests green)**
but **NOT cleared** — it's waiting for your review/testing. Work top-down.

> Reminder that applies to everything: **hard-refresh (Cmd+Shift+R)** after pulling,
> because the CodeMirror editor initializes once and stale HMR instances mislead.

---

## Status legend
- 🟡 **ready for revision** — built, self-tested, awaiting your sign-off
- ⛔ **held on purpose** — see note

---

## Features

<!-- newest at the bottom; I append as I finish each -->

### 🟡 #4 — Shareable links
**Test:** click **share** in the toolbar → a link is copied to your clipboard (you'll see "link copied to clipboard"). Open that link in a new tab / another browser → the exact model loads in the editor. Try it from both **canvas** and **editor** mode (canvas serializes the model to text first).
**Notes:**
- The model rides in the URL **fragment** (`#m=…`), which is compressed (lz-string) and **never sent to a server** — consistent with "nothing leaves your browser." Verify by looking at the URL: everything after `#`.
- Past ~8000 chars it refuses and says "copy the text instead" (rather than emitting a broken URL). Big models → use copy-paste of the DSL.
- Clipboard needs a secure context; on `localhost` it works. If `navigator.clipboard` is blocked, it logs the URL to the console and says so.
- 5 unit tests cover encode/decode round-trip + hash parsing.

### 🟡 #5 — Examples gallery
**Test:** click **examples ▾** in the toolbar → a menu of 4 curated models (Users & orders, Multi-tenant SaaS, Social feed, Event ticketing). Pick one → it loads into the editor; step through it, toggle GSI panes, share it. Click the backdrop to dismiss the menu without choosing.
**Notes:**
- Each example is plain DSL in `src/model/examples.ts` — a contributor adds one by appending an entry (that's the open-source flywheel). A test asserts every example parses with no errors and yields items, so a broken contribution fails CI.
- Loads via the **same** `loadModel` path as shared links — one loader, two entry points.
- Each carries its access patterns as `#` comments at the top (sets up the auto-play narration work later).
