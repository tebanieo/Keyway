/**
 * The seed scenario written in the DSL — the default editor document. Parsing
 * this yields the same 8-step story as SEED_OPS, but now it's authored text you
 * can edit live. Items carry a `_type` tag so the editor can derive entity
 * templates (type `order` on a fresh line to scaffold one).
 */
export const DEFAULT_DOC = `# data-canvas — a single-table model as a script.
# One line = one operation = one step. "label:" puts an item; the label is its
# stable id, so repeating it edits the same item. Change a PK/SK on a repeated
# label and it becomes an atomic key change (delete + put). "delete label" removes.
# The _type tag groups items into entities you can reuse.

# Indexes are declared with @gsi. Add more (e.g. @gsi GSI2 pk=GSI2PK sk=GSI2SK
# projection=keys) and a pane appears for each.
@gsi GSI1 pk=GSI1PK sk=GSI1SK projection=all

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
