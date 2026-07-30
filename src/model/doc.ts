/**
 * The seed scenario written in the DSL — the default editor document. Parsing
 * this yields the same 8-step story as SEED_OPS, but now it's authored text you
 * can edit live.
 */
export const DEFAULT_DOC = `# data-canvas — a single-table model as a script.
# One line = one operation = one step. "label:" puts an item; the label is its
# stable id, so repeating it edits the same item. Change a PK/SK on a repeated
# label and it becomes an atomic key change (delete + put). "delete label" removes.

u1: PK=USER#1  SK=PROFILE  name=Ada Lovelace  email=ada@analytical.io  GSI1PK=EMAIL#ada@analytical.io  GSI1SK=USER#1
u2: PK=USER#2  SK=PROFILE  name=Alan Turing  email=alan@enigma.uk  GSI1PK=EMAIL#alan@enigma.uk  GSI1SK=USER#2

# settings carry no GSI1 key, so they stay off the index (sparse)
s1: PK=USER#1  SK=SETTINGS#notif  channel=email  frequency=daily

o1: PK=USER#1  SK=ORDER#2024-01  total=42.00  status=pending  GSI1PK=STATUS#pending  GSI1SK=2024-01-14
o2: PK=USER#1  SK=ORDER#2024-02  total=17.50  status=pending  GSI1PK=STATUS#pending  GSI1SK=2024-02-03
o3: PK=USER#2  SK=ORDER#2024-03  total=99.99  status=pending  GSI1PK=STATUS#pending  GSI1SK=2024-03-21

# order ships: same key, so a plain put — but GSI1 reindexes (pending -> shipped)
o1: PK=USER#1  SK=ORDER#2024-01  total=42.00  status=shipped  GSI1PK=STATUS#shipped  GSI1SK=2024-01-14

delete o2
`;
