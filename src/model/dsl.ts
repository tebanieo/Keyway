import { keyOf } from "../engine/engine";
import type { IndexSpec, Item, Op } from "../engine/types";

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

export function parseDoc(text: string, baseIndex: IndexSpec): ParseResult {
  const ops: Op[] = [];
  const diagnostics: Diagnostic[] = [];
  const lastKey = new Map<string, string>(); // label -> base key when last put

  const lines = text.split("\n");
  lines.forEach((raw, line) => {
    const s = raw.trim();
    if (s === "" || s.startsWith("#")) return;

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
    const newKey = keyOf(item, baseIndex);

    if (newKey === null) {
      const need = baseIndex.sk
        ? `${baseIndex.pk} and ${baseIndex.sk}`
        : baseIndex.pk;
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

  return { ops, diagnostics };
}
