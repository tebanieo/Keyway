import { keyOf } from "../engine/engine";
import type { IndexSpec, Item, Op, ProjectionSpec } from "../engine/types";

/**
 * A tiny, readable text format for a single-table model. One line = one op =
 * one step. It's deliberately writable and diffable by hand (the repo-artifact
 * property): you can read it cold in a PR or edit it in vim, no editor required.
 *
 *   # comments start with hash, blank lines ignored
 *   u1: PK=USER#1  SK=PROFILE  name=Ada Lovelace  GSI1PK=EMAIL#ada  GSI1SK=USER#1
 *   o1: PK=USER#1  SK=ORDER#1  status=pending
 *   o1: PK=USER#1  SK=ORDER#1  status=shipped     # same key -> a put (update)
 *   o1: PK=USER#2  SK=ORDER#1  status=shipped     # new key  -> atomic transact
 *   delete o1
 *
 * The label before the colon is the item's stable id — so a repeated label is
 * the *same* item (a pin follows it), and a repeated label with a different
 * PK/SK is a key change, which we emit as an atomic delete+put transaction.
 */

export interface Diagnostic {
  /** 0-based line index. */
  line: number;
  message: string;
  severity: "error" | "warning";
}

export interface ParseResult {
  ops: Op[];
  diagnostics: Diagnostic[];
  /** Base table keys, from `@table` (or the passed default: PK/SK). */
  base: IndexSpec;
  /** GSIs declared via `@gsi` lines (or a default GSI1 if none are). */
  gsis: IndexSpec[];
}

/** Default GSIs when the document declares none. */
const DEFAULT_GSIS: IndexSpec[] = [{ name: "GSI1", pk: "GSI1PK", sk: "GSI1SK" }];

/** Parse a `projection=` value: `all` | `keys`/`keys_only` | comma list. */
function parseProjection(v: string | undefined): ProjectionSpec | undefined {
  if (!v) return undefined;
  const low = v.toLowerCase();
  if (low === "all") return undefined;
  if (low === "keys" || low === "keys_only") return "KEYS_ONLY";
  return v.split(",").map((s) => s.trim()).filter(Boolean);
}

const LABEL = /^([A-Za-z0-9_]+)\s*:\s*(.*)$/;
const DELETE = /^(?:delete|del|-)\s*([A-Za-z0-9_]+)\s*$/;
// A key=value pair whose value runs until the next ` key=` or end of line, so
// values may contain spaces (name=Ada Lovelace) without needing quotes.
const PAIR = /(\w+)=(.*?)(?=\s+\w+=|\s*$)/g;

function parseAttrs(body: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (const m of body.matchAll(PAIR)) {
    const value = m[2].trim();
    if (value !== "") attrs[m[1]] = value;
  }
  return attrs;
}

const SP = String.fromCharCode(32); // avoid literal spaces in string sources

/** Render one item as a DSL line: `label: PK=..  SK=..  attr=..`. */
function itemLine(item: Item, baseIndex: IndexSpec): string {
  const lead = [baseIndex.pk, baseIndex.sk]
    .filter((k): k is string => typeof k === "string")
    .filter((k) => k in item.attrs);
  const rest = Object.keys(item.attrs).filter((k) => !lead.includes(k));
  const pairs = [...lead, ...rest].map((k) => `${k}=${item.attrs[k]}`);
  return `${item.id}:${SP}${pairs.join(SP + SP)}`;
}

/**
 * Serialize ops back to DSL text — the inverse of parseDoc (modulo comments and
 * spacing). Used when opening the editor on a model that was built by direct
 * manipulation, so text and grid stay one source of truth. A transact renders
 * as its put line: re-parsing that line against the prior key re-derives the
 * transaction, so the round-trip is stable.
 */
export function serializeOps(ops: readonly Op[], baseIndex: IndexSpec): string {
  const lines = ops.map((op) => {
    if (op.kind === "delete") return `delete${SP}${op.id}`;
    if (op.kind === "transact") {
      const put = op.actions.find((a) => a.kind === "put");
      return put && put.kind === "put" ? itemLine(put.item, baseIndex) : "";
    }
    return itemLine(op.item, baseIndex);
  });
  return lines.filter((l) => l !== "").join("\n") + "\n";
}

/** Serialize declared GSIs back to `@gsi` directive lines. */
export function serializeGsis(gsis: readonly IndexSpec[]): string {
  if (gsis.length === 0) return "";
  const lines = gsis.map((g) => {
    const parts = ["@gsi", g.name, `pk=${(g.pks ?? [g.pk]).join(",")}`];
    const sks = g.sks ?? (g.sk ? [g.sk] : []);
    if (sks.length) parts.push(`sk=${sks.join(",")}`);
    const p = g.projection;
    if (p === "KEYS_ONLY") parts.push("projection=keys");
    else if (Array.isArray(p)) parts.push(`projection=${p.join(",")}`);
    return parts.join(SP);
  });
  return lines.join("\n") + "\n";
}

/** Serialize a non-default base table as an `@table` line (default PK/SK omitted). */
export function serializeTable(base: IndexSpec): string {
  if (base.pk === "PK" && base.sk === "SK") return "";
  const parts = ["@table", `pk=${base.pk}`];
  if (base.sk) parts.push(`sk=${base.sk}`);
  return parts.join(SP) + "\n";
}

const DIRECTIVE = /^@(\w+)\s+(.*)$/;
const GSI_NAME = /^(\S+)\s*(.*)$/;

export function parseDoc(text: string, baseIndex: IndexSpec): ParseResult {
  const ops: Op[] = [];
  const diagnostics: Diagnostic[] = [];
  const lastKey = new Map<string, string>(); // label -> base key when last put
  const lines = text.split("\n");

  // Pass 1: directives -> index config.
  let base: IndexSpec = { name: "base", pk: baseIndex.pk, sk: baseIndex.sk };
  const gsis: IndexSpec[] = [];
  lines.forEach((raw, line) => {
    const s = raw.trim();
    if (!s.startsWith("@")) return;
    const d = DIRECTIVE.exec(s);
    if (!d) {
      diagnostics.push({ line, message: "malformed directive", severity: "error" });
      return;
    }
    const [, kind, rest] = d;
    if (kind === "gsi") {
      const nm = GSI_NAME.exec(rest);
      const attrs = nm ? parseAttrs(nm[2]) : {};
      if (!nm || !attrs.pk) {
        diagnostics.push({
          line,
          message: "@gsi needs a name and pk= (e.g. `@gsi GSI2 pk=GSI2PK sk=GSI2SK`)",
          severity: "error",
        });
        return;
      }
      // pk / sk may be comma-lists for a multi-key GSI (up to 4 each).
      const pkList = attrs.pk.split(",").map((s) => s.trim()).filter(Boolean);
      const skList = attrs.sk
        ? attrs.sk.split(",").map((s) => s.trim()).filter(Boolean)
        : [];
      if (pkList.length > 4 || skList.length > 4) {
        diagnostics.push({
          line,
          message: "a multi-key GSI allows at most 4 partition and 4 sort attributes",
          severity: "warning",
        });
      }
      gsis.push({
        name: nm[1],
        pk: pkList[0],
        pks: pkList.length > 1 ? pkList : undefined,
        sk: skList[0],
        sks: skList.length > 1 ? skList : undefined,
        projection: parseProjection(attrs.projection),
      });
    } else if (kind === "table") {
      const attrs = parseAttrs(rest);
      if (!attrs.pk) {
        diagnostics.push({
          line,
          message: "@table needs pk= (e.g. `@table pk=PK sk=SK`, or pk= alone for a PK-only table)",
          severity: "error",
        });
        return;
      }
      base = { name: "base", pk: attrs.pk, sk: attrs.sk }; // sk absent -> PK-only
    } else {
      diagnostics.push({ line, message: `unknown directive @${kind}`, severity: "warning" });
    }
  });
  if (gsis.length === 0) gsis.push(...DEFAULT_GSIS.map((g) => ({ ...g })));

  // Pass 2: item / delete lines.
  lines.forEach((raw, line) => {
    const s = raw.trim();
    if (s === "" || s.startsWith("#") || s.startsWith("@")) return;

    const del = DELETE.exec(s);
    if (del) {
      ops.push({ kind: "delete", id: del[1] });
      lastKey.delete(del[1]);
      return;
    }

    const m = LABEL.exec(s);
    if (!m) {
      diagnostics.push({
        line,
        message: "expected `label: key=value ...` or `delete label`",
        severity: "error",
      });
      return;
    }

    const [, label, body] = m;
    const attrs = parseAttrs(body);
    const item: Item = { id: label, attrs };
    const newKey = keyOf(item, base);

    if (newKey === null) {
      const need = base.sk ? `${base.pk} and ${base.sk}` : base.pk;
      diagnostics.push({
        line,
        message: `item "${label}" is missing its key (${need}); it won't appear`,
        severity: "warning",
      });
    }

    const prevKey = lastKey.get(label);
    if (prevKey && newKey && prevKey !== newKey) {
      // key changed -> atomic delete-old + put-new (a TransactWriteItems)
      ops.push({
        kind: "transact",
        actions: [{ kind: "delete", id: label }, { kind: "put", item }],
      });
    } else {
      ops.push({ kind: "put", item });
    }
    if (newKey) lastKey.set(label, newKey);
  });

  return { ops, diagnostics, base, gsis };
}
