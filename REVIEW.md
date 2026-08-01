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

### 🟡 #3 — Multi-key GSIs (native composite keys)
**Test:** load the **Multi-key GSI** example (examples menu). It declares `@gsi ByRegion pk=tenant,region sk=status,date`. Open **split** — the `ByRegion` pane groups partitions by the **tuple** (`acme · us`, `acme · eu`, `globex · us`) and sorts within each by `status` then `date`. In the editor, `@gsi X pk=a,b sk=c,d` (comma lists, up to 4 each) creates one; the `X` completion inserts all four key attrs.
**Notes:**
- This is the **native** feature (separate typed attributes), NOT concatenation. Data-model layer only — the query *rules* (equality on all pk, range only on the last sk, no skipping) land with **#1 Query**.
- Design choice for your review: kept `pk`/`sk` as single-key fields (+ optional `pks`/`sks` arrays) so base tables and every existing model/test were untouched; `pkAttrs`/`skAttrs` helpers centralize it. Partition display joins values with " · ".
- Sparse over the whole tuple: an item missing *any* pk or sk attribute is excluded (see the `d` item test).
- 5 tests: multi-pk grouping, multi-sk sort, tuple-sparse, comma-list parse + round-trip, >4 warning.

### 🟡 #1 — Query / GetItem / Scan + RCU  ⚠️ engine solid; UI is a FIRST CUT
**Test:** click **query** in the toolbar → a panel opens. Try:
- **get** on base: pk `USER#1`, sk `PROFILE` → 1 read, the profile lights green.
- **query** on base: pk `USER#1`, sk `begins_with ORDER#` → the orders light green; the profile is NOT read. Add a **filter** `status = pending` → fewer rows stay green (returned) but the readout still says you *read* all the orders (**filters don't save RCU** — that's the lesson; the amber rows are "read but filtered out").
- **scan** → **every** item lights up and RCU jumps — the expensive read.
- Load the **Multi-key GSI** example, query index `ByRegion`: it shows an equality box per partition attr (`tenant`, `region`) and, for the sort keys, `status` locked to `=` with only the LAST (`date`) getting an operator dropdown. Put a range on `status` → you can't (it's locked); the engine also returns a rule error if you force it.
**Notes / decisions for your review:**
- **The engine (`runQuery`) is the solid, tested part (12 tests).** The **panel UI is a deliberate first cut** — functional, wired, but NOT styled to the "professional" bar (that's the #8 design pass). Expect rough edges in layout; tell me how you want the query builder to feel and I'll rebuild the UI.
- Green row = returned; amber row = read-but-filtered (visualizes "filters don't reduce cost").
- RCU model: 0.5/item eventually-consistent, 1/item strong, assuming each item ≤4KB. There's a **strong** checkbox. This is a teaching approximation — real RCU is size-based; noted.
- Comparisons are lexicographic (string) — fine for dates/prefixes; numbers-as-strings would sort lexically. Real multi-key would compare by native type; flagged for later.
- Query runs against the model **at the current step** (respects the scrubber).
