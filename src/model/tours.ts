/**
 * Guided tours: short, curated models the Learn drawer loads and AUTO-PLAYS.
 * Each is plain DSL text (same loadModel() path a shared link or example uses),
 * but authored to read like a lesson: a `#` comment sits directly above the
 * meaningful steps so the note surfaces as narration while playback scrubs.
 * Keep them tight (a handful of ops) so the story lands in one pass.
 */
export interface Tour {
  name: string;
  blurb: string;
  dsl: string;
  /** Where to look while it plays. "editor" keeps the script visible (for the
   *  tour about the tool itself); "tables" (the default) collapses the editor
   *  so the panes lead, which is right for the modeling-concept tours. */
  focus?: "editor" | "tables";
}

// First contact: learn the ropes of the tool itself, not a modeling concept.
// Keeps the editor open so you watch the script step as each line runs.
const GETTING_STARTED = `# Getting Started: a Keyway model is just a script. One line is one operation,
# and one operation is one step. Press play up top (or step with the arrows) and
# watch the base table on the right fill in as each line runs.
@table AppTable pk=PK sk=SK

# This is a "put": it adds an item. The label u1 is its id; PK and SK are the
# table's keys, and the rest are plain attributes. Step forward and it appears.
u1: PK=USER#1  SK=PROFILE  name=Ada Lovelace  email=ada@analytical.io  _type=user-profile

# Another put under the same PK. Items that share a partition key sit together,
# and that grouping is the whole point of single-table design.
o1: PK=USER#1  SK=ORDER#2024-01  total=42.00  status=pending  _type=order

# Reuse a label to UPDATE the same item. Same u1, one new attribute (plan=pro),
# so the row changes in place. It never duplicates, because the label is its id.
u1: PK=USER#1  SK=PROFILE  name=Ada Lovelace  email=ada@analytical.io  plan=pro  _type=user-profile

# "delete label" removes an item. Put, update, delete: that is the whole editor.
# From here, open Examples for real models, Docs for the reference, or the other
# tours to learn indexes and key changes.
delete o1
`;

// A shipping order moves across the GSI while updating in place on the base.
const REINDEX = `# Reindex on Ship: shipping an order moves it across the GSI, in place on the base.
@table AppTable pk=PK sk=SK
@gsi GSI1 pk=GSI1PK sk=GSI1SK projection=all

@ap List pending orders -> GSI1 GSI1PK=STATUS#pending
@ap List shipped orders -> GSI1 GSI1PK=STATUS#shipped

# Three orders arrive pending. GSI1 overloads status into its partition key, so
# STATUS#pending gathers every open order under one queryable partition.
o1: PK=USER#1  SK=ORDER#2024-01  total=42.00  status=pending  GSI1PK=STATUS#pending  GSI1SK=2024-01-14  _type=order
o2: PK=USER#1  SK=ORDER#2024-02  total=17.50  status=pending  GSI1PK=STATUS#pending  GSI1SK=2024-02-03  _type=order
o3: PK=USER#2  SK=ORDER#2024-03  total=99.99  status=pending  GSI1PK=STATUS#pending  GSI1SK=2024-03-21  _type=order

# o1 ships: same PK and SK, so the base row just updates in place (a plain put).
# But GSI1PK flips pending -> shipped, so the write REINDEXES o1: it leaves the
# STATUS#pending partition and lands under STATUS#shipped. One put, two effects.
o1: PK=USER#1  SK=ORDER#2024-01  total=42.00  status=shipped  GSI1PK=STATUS#shipped  GSI1SK=2024-01-14  _type=order
`;

// Items without the GSI key never reach the index. That absence is the point.
const SPARSE = `# Sparse Index: an index only holds items that carry its key. Leave the key off
# and the item stays off the index, so the index holds only rows worth looking up.
@table AppTable pk=PK sk=SK
@gsi GSI1 pk=GSI1PK sk=GSI1SK projection=all

@ap Look up a user by email -> GSI1 GSI1PK=EMAIL#ada@analytical.io

# Two profiles carry GSI1PK=EMAIL#..., so both appear on GSI1, keyed by email.
u1: PK=USER#1  SK=PROFILE  name=Ada Lovelace  email=ada@analytical.io  GSI1PK=EMAIL#ada@analytical.io  GSI1SK=USER#1  _type=user-profile
u2: PK=USER#2  SK=PROFILE  name=Alan Turing  email=alan@enigma.uk  GSI1PK=EMAIL#alan@enigma.uk  GSI1SK=USER#2  _type=user-profile

# A settings item carries NO GSI1 key, so it never reaches GSI1. The email index
# stays lean: no clutter, no wasted writes to keep a row you never query by email.
s1: PK=USER#1  SK=SETTINGS#notif  channel=email  frequency=daily  _type=settings

# A login session skips GSI1 too. Sparseness is deliberate: only the rows that
# opt in (by carrying the key) cost you an index entry.
sess1: PK=USER#2  SK=SESSION#a91  ip=10.0.0.4  _type=session
`;

// Changing a key is a move, not an edit: a delete of the old key + a put of the new.
const ATOMIC = `# Atomic Key Change: changing an item's key is a MOVE, not an edit. There is no
# rename, so Keyway emits a delete of the old key + a put of the new, as one txn.
@table AppTable pk=PK sk=SK

# A draft ticket lands under its author's partition.
t1: PK=USER#1  SK=TICKET#draft  title=Fix the export  status=draft  _type=ticket

# Reopen it: same label t1, but SK changes to TICKET#open. A repeated label with
# a new key is not an in-place update. It is an atomic delete + put, so the old
# TICKET#draft row vanishes and TICKET#open appears together, in one step.
t1: PK=USER#1  SK=TICKET#open  title=Fix the export  status=open  _type=ticket

# Reassign it: now the PK changes too. Same rule, the row relocates partitions
# atomically. Touching a KEY is always a move, never an edit.
t1: PK=USER#2  SK=TICKET#open  title=Fix the export  status=open  owner=bob  _type=ticket

# For contrast: editing a non-key value is a plain put. Same key, so the row
# stays put and only its title changes. Keys move rows, values do not.
t1: PK=USER#2  SK=TICKET#open  title=Fix the CSV export  status=open  owner=bob  _type=ticket
`;

export const TOURS: Tour[] = [
  {
    name: "Getting Started",
    blurb: "learn the ropes: how the script, steps, and panes work before the modeling",
    dsl: GETTING_STARTED,
    focus: "editor",
  },
  {
    name: "GSI Overloading",
    blurb: "an order ships pending -> shipped; the base row updates in place, the GSI partition moves",
    dsl: REINDEX,
  },
  {
    name: "Sparse Index",
    blurb: "items with the GSI key appear; ones without stay off it, so the index holds only what you query",
    dsl: SPARSE,
  },
  {
    name: "Atomic Key Change",
    blurb: "repeat a label with a changed PK or SK and it becomes a delete + put: a move, not an edit",
    dsl: ATOMIC,
  },
];
