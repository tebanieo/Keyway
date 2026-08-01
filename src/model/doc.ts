/**
 * The seed scenario written in the DSL — the default editor document. Parsing
 * this yields the same 8-step story as SEED_OPS, but now it's authored text you
 * can edit live. Items carry a `_type` tag so the editor can derive entity
 * templates (type `order` on a fresh line to scaffold one).
 */
/** The blank slate the app opens on (and `reset` returns to): structure, no data. */
export const EMPTY_DOC = `# Empty model — start typing items below, or load an example (examples ▾).
# Structure: @table names the base table, @gsi adds an index, @ap declares an
# access pattern. Then add items:  label: PK=…  SK=…
@table AppTable pk=PK sk=SK
@gsi GSI1 pk=GSI1PK sk=GSI1SK
`;

export const DEFAULT_DOC = `# data-canvas — a single-table model as a script.
# One line = one operation = one step. "label:" puts an item; the label is its
# stable id, so repeating it edits the same item. Change a PK/SK on a repeated
# label and it becomes an atomic key change (delete + put). "delete label" removes.
# The _type tag groups items into entities you can reuse.

# The base table (named) + its indexes. @table names it; @gsi adds an index
# (a pane appears for each). Add e.g. @gsi GSI2 pk=GSI2PK sk=GSI2SK projection=keys.
@table AppTable pk=PK sk=SK
@gsi GSI1 pk=GSI1PK sk=GSI1SK projection=all

# Access patterns are the SPEC — what the design must serve. "-> Index" links
# one to the index (base table or GSI) that serves it; the panel flags coverage.
@ap Get a user's profile and orders -> AppTable
@ap Look up a user by email -> GSI1
@ap List orders by status -> GSI1
@ap Get a user's notification settings by type

u1: PK=USER#1  SK=PROFILE  name=Ada Lovelace  email=ada@analytical.io  GSI1PK=EMAIL#ada@analytical.io  GSI1SK=USER#1  _type=user-profile
u2: PK=USER#2  SK=PROFILE  name=Alan Turing  email=alan@enigma.uk  GSI1PK=EMAIL#alan@enigma.uk  GSI1SK=USER#2  _type=user-profile

# settings carry no GSI1 key, so they stay off the index (sparse)
s1: PK=USER#1  SK=SETTINGS#notif  channel=email  frequency=daily  _type=settings

o1: PK=USER#1  SK=ORDER#2024-01  total=42.00  status=pending  GSI1PK=STATUS#pending  GSI1SK=2024-01-14  _type=order
o2: PK=USER#1  SK=ORDER#2024-02  total=17.50  status=pending  GSI1PK=STATUS#pending  GSI1SK=2024-02-03  _type=order
o3: PK=USER#2  SK=ORDER#2024-03  total=99.99  status=pending  GSI1PK=STATUS#pending  GSI1SK=2024-03-21  _type=order

# order ships: same key, so a plain put — but GSI1 reindexes (pending -> shipped)
o1: PK=USER#1  SK=ORDER#2024-01  total=42.00  status=shipped  GSI1PK=STATUS#shipped  GSI1SK=2024-01-14  _type=order

delete o2
`;
