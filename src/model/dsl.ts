import { keyOf, pkAttrs, skAttrs } from "../engine/engine";
import { parseExpression, splitClauses } from "../engine/expression";
import type { AttributeValue } from "../engine/extenddb";
import type { Condition, IndexSpec, Item, Op, ProjectionSpec, WriteAction } from "../engine/types";

/**
 * A tiny, readable text format for a DynamoDB data model. One line = one op =
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
 * The label before the colon is the item's stable id. So a repeated label is
 * the *same* item (a pin follows it), and a repeated label with a different
 * PK/SK is a key change, which we emit as an atomic delete+put transaction.
 */

export interface Diagnostic {
  /** 0-based line index. */
  line: number;
  message: string;
  severity: "error" | "warning";
}

/** A declared access pattern (the SPEC): what a query needs to serve. */
export interface AccessPattern {
  /** Auto-assigned number (AP1, AP2, …) by declaration order. */
  n: number;
  description: string;
  /** Optional index declared to serve it (`@ap … -> GSI1`). */
  index?: string;
  /** Read op the pattern uses against that index (default: query). */
  readOp?: "get" | "query" | "scan";
  /**
   * What makes it a real, runnable read, as written:
   * - query: a KeyConditionExpression and its pairs (`GSI1PK = :e  :e=EMAIL#ada`),
   *   validated against the index's keys when the pattern runs (coverage);
   * - get: the Key, as `attr=value` pairs (`PK=USER#1 SK=PROFILE`).
   */
  keyText?: string;
  /** 0-based source line, so the editor can run the pattern under its caret. */
  line?: number;
}

/** `@ap … -> <Index> [get|query|scan] [key]`: split the tail after the arrow. */
function parseApTail(tail: string): {
  index?: string;
  readOp: "get" | "query" | "scan";
  keyText?: string;
} {
  const m = /^\s*(\S+)?\s*(?:\b(get|query|scan)\b)?\s*(.*)$/.exec(tail)!;
  const keyText = m[3].trim();
  return {
    index: m[1],
    readOp: (m[2] as "get" | "query" | "scan" | undefined) ?? "query",
    keyText: keyText || undefined,
  };
}

/**
 * A GetItem `Key` as the API writes it: `key={"PK": {"S": "ORDER#1"}, …}`.
 * Returns the typed key, or DynamoDB-style help when it isn't one.
 */
export function parseGetKey(text: string): Record<string, AttributeValue> | string {
  const split = splitClauses(text, ["key"]);
  if ("error" in split) return split.error;
  const key = split.clauses.key;
  if (split.expression !== "" || key === undefined) {
    return 'a GetItem takes its Key as key={"PK": {"S": "…"}, "SK": {"S": "…"}}';
  }
  if (typeof key !== "object" || key === null || Array.isArray(key)) {
    return "key= must be an object of key attributes to typed values";
  }
  for (const [attr, av] of Object.entries(key)) {
    const types = av && typeof av === "object" ? Object.keys(av) : [];
    if (types.length !== 1 || !["S", "N", "B"].includes(types[0])) {
      return `key: "${attr}" must be a typed key value, e.g. {"S": "ORDER#1"} or {"N": "42"}`;
    }
  }
  return key as Record<string, AttributeValue>;
}

// Pre-API forms of an @ap key: compact `PK=USER#1 SK begins_with ORDER#`, or
// trailing `:u=USER#1` pairs. Both mean values written outside values={…}.
const OLD_AP_KEY = /(^|\s)(\w+=[^:\s{]|[#:]\w+=)/;

export interface ParseResult {
  ops: Op[];
  diagnostics: Diagnostic[];
  /** Access patterns declared via `@ap` lines. */
  aps: AccessPattern[];
  /** Base table keys, from `@table` (or the passed default: PK/SK). */
  base: IndexSpec;
  /** GSIs declared via `@gsi` lines (or a default GSI1 if none are). */
  gsis: IndexSpec[];
  /** Per-op narration (a comment directly above the line), aligned with `ops`. */
  notes: (string | undefined)[];
  /** 0-based source line each op came from, aligned with `ops`. Drives the
   *  editor's step highlight (which line the current step is running). */
  opLines: number[];
}

/** Parse a `projection=` value: `all` | `keys`/`keys_only` | comma list. */
function parseProjection(v: string | undefined): ProjectionSpec | undefined {
  if (!v) return undefined;
  const low = v.toLowerCase();
  if (low === "all") return undefined;
  if (low === "keys" || low === "keys_only") return "KEYS_ONLY";
  return v
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

const LABEL = /^([A-Za-z0-9_]+)\s*:\s*(.*)$/;
const DELETE = /^(?:delete|del|-)\s*([A-Za-z0-9_]+)\s*$/;
const CHECK = /^check\s+([A-Za-z0-9_]+)\s*$/;
/** `@transact` opens a TransactWriteItems block, `@end` closes it. */
const TX_OPEN = /^@transact\s*$/i;
const TX_END = /^@end\s*$/i;
/** DynamoDB's limit on actions in one TransactWriteItems. */
const TX_MAX = 100;
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

/**
 * Set one attribute on an item line, in place: replace `key=old` with
 * `key=value`, add `  key=value` before any `@if` when it isn't there, or drop
 * the pair when `value` is empty. Everything else on the line (other pairs,
 * spacing, the guard) is left as written.
 */
export function setAttrInLine(line: string, key: string, value: string): string {
  const ifAt = line.search(/\s@if\s/);
  const head = ifAt >= 0 ? line.slice(0, ifAt).replace(/\s+$/, "") : line;
  const tail = ifAt >= 0 ? `${SP}${SP}${line.slice(ifAt).trimStart()}` : "";
  const esc = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pair = new RegExp(`(^|\\s)${esc}=(.*?)(?=\\s+\\w+=|\\s*$)`);
  const m = pair.exec(head);
  let next: string;
  if (m) {
    const start = m.index + m[1].length;
    const end = m.index + m[0].length;
    next =
      value === ""
        ? head.slice(0, m.index).replace(/\s+$/, "") + head.slice(end)
        : head.slice(0, start) + `${key}=${value}` + head.slice(end);
  } else {
    next = value === "" ? head : `${head.replace(/\s+$/, "")}${SP}${SP}${key}=${value}`;
  }
  return next + tail;
}

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
 * Serialize ops back to DSL text: the inverse of parseDoc (modulo comments and
 * spacing). Used when opening the editor on a model that was built by direct
 * manipulation, so text and grid stay one source of truth. A transact renders
 * as its put line: re-parsing that line against the prior key re-derives the
 * transaction, so the round-trip is stable.
 */
export function serializeOps(ops: readonly Op[], baseIndex: IndexSpec): string {
  const guard = (c: Condition | undefined) => (c ? `${SP}${SP}@if${SP}${c.text}` : "");
  const action = (a: WriteAction): string =>
    a.kind === "check"
      ? `check${SP}${a.id}${guard(a.condition)}`
      : a.kind === "delete"
        ? `delete${SP}${a.id}${guard(a.condition)}`
        : itemLine(a.item, baseIndex) + guard(a.condition);
  const lines = ops.map((op) => {
    if (op.kind === "delete") return `delete${SP}${op.id}${guard(op.condition)}`;
    if (op.kind === "transact" && op.explicit) {
      // a key change inside the block is its put line (the delete is implied)
      const body = op.actions.filter(
        (a, i) =>
          !(
            a.kind === "delete" &&
            op.actions[i + 1]?.kind === "put" &&
            (op.actions[i + 1] as { item: Item }).item.id === a.id
          ),
      );
      return ["@transact", ...body.map(action), "@end"].join("\n");
    }
    if (op.kind === "transact") {
      const put = op.actions.find((a) => a.kind === "put");
      return put && put.kind === "put" ? itemLine(put.item, baseIndex) + guard(put.condition) : "";
    }
    return itemLine(op.item, baseIndex) + guard(op.condition);
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

/** Serialize the base table as an `@table` line, emitted when it's named or has
 *  non-default keys (a plain PK/SK unnamed table stays implicit). */
export function serializeTable(base: IndexSpec): string {
  const named = base.name !== "base";
  const custom = base.pk !== "PK" || base.sk !== "SK";
  if (!named && !custom) return "";
  const parts = named ? ["@table", base.name] : ["@table"];
  parts.push(`pk=${base.pk}`);
  if (base.sk) parts.push(`sk=${base.sk}`);
  return parts.join(SP) + "\n";
}

const DIRECTIVE = /^@(\w+)\s+(.*)$/;
const GSI_NAME = /^(\S+)\s*(.*)$/;

/** Edit distance, capped: is `a` one typo away from `b`? */
function oneTypo(a: string, b: string): boolean {
  if (a === b) return false;
  if (a.toLowerCase() === b.toLowerCase()) return true;
  if (Math.abs(a.length - b.length) > 1 || Math.min(a.length, b.length) < 4) return false;
  let i = 0;
  while (i < a.length && a[i] === b[i]) i++;
  let j = 0;
  while (j < a.length - i && j < b.length - i && a[a.length - 1 - j] === b[b.length - 1 - j]) j++;
  return a.length - i - j <= 1 && b.length - i - j <= 1;
}

/**
 * Likely design slips on an item line that parse fine but quietly change the
 * picture: a key attribute name one typo off (the item silently misses that
 * index), half of an index's key (no index entry), and a value holding a
 * `name=` (two pairs run together).
 */
function slips(attrs: Record<string, string>, base: IndexSpec, gsis: IndexSpec[]): string[] {
  const out: string[] = [];
  const indexes = [base, ...gsis];
  const keyNames = new Set(indexes.flatMap((ix) => [...pkAttrs(ix), ...skAttrs(ix)]));
  for (const name of Object.keys(attrs)) {
    if (keyNames.has(name)) continue;
    const near = [...keyNames].find((k) => oneTypo(name, k));
    if (near) {
      const ix = indexes.find((i) => [...pkAttrs(i), ...skAttrs(i)].includes(near))!;
      out.push(
        `"${name}" looks like "${near}" (a key of ${ix.name}): as written, this item isn't in ${ix.name}`,
      );
    }
  }
  for (const g of gsis) {
    const keys = [...pkAttrs(g), ...skAttrs(g)];
    const has = keys.filter((k) => attrs[k] !== undefined);
    if (has.length > 0 && has.length < keys.length) {
      const missing = keys.filter((k) => attrs[k] === undefined);
      out.push(
        `has ${has.join(", ")} but no ${missing.join(", ")}: it won't appear in ${g.name} (an index entry needs all of its key attributes)`,
      );
    }
  }
  for (const [name, value] of Object.entries(attrs)) {
    const run = /(?:^|[^\w])([A-Za-z_]\w*)=/.exec(value);
    if (run) {
      out.push(
        `${name}=${value} holds "${run[1]}=": two pairs run together? Separate them with two spaces`,
      );
    }
  }
  return out;
}

export function parseDoc(text: string, baseIndex: IndexSpec): ParseResult {
  const ops: Op[] = [];
  const notes: (string | undefined)[] = []; // narration, aligned with ops
  const opLines: number[] = []; // 0-based source line per op, aligned with ops
  const diagnostics: Diagnostic[] = [];
  const lastKey = new Map<string, string>(); // label -> base key when last put
  const lines = text.split("\n");

  // Pass 1: directives -> index config.
  let base: IndexSpec = { name: "base", pk: baseIndex.pk, sk: baseIndex.sk };
  const gsis: IndexSpec[] = [];
  const aps: AccessPattern[] = [];
  const apLines: number[] = []; // source line of each @ap, for diagnostics
  lines.forEach((raw, line) => {
    const s = raw.trim();
    if (!s.startsWith("@")) return;
    if (TX_OPEN.test(s) || TX_END.test(s)) return; // read with the writes
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
      // A multi-key GSI uses a comma list (`pk=a,b`). Repeated `pk=`/`sk=` is a
      // common mistake: parseAttrs silently keeps only the last, collapsing the
      // index to a single key (the "only the first key shows" trap). Flag it.
      const dupPk = (nm[2].match(/(?:^|\s)pk=/g) ?? []).length > 1;
      const dupSk = (nm[2].match(/(?:^|\s)sk=/g) ?? []).length > 1;
      if (dupPk || dupSk) {
        diagnostics.push({
          line,
          message:
            "multi-key GSI: use a comma list (`pk=a,b`), not repeated `pk=` - only the last was kept",
          severity: "warning",
        });
      }
      // pk / sk may be comma-lists for a multi-key GSI (up to 4 each).
      const pkList = attrs.pk
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      const skList = attrs.sk
        ? attrs.sk
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean)
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
      // @table [Name] pk=.. sk=..: a leading bareword (no "=") names the table
      const first = /^(\S+)(?:\s+([\s\S]*))?$/.exec(rest);
      let name = "base";
      let attrText = rest;
      if (first && !first[1].includes("=")) {
        name = first[1];
        attrText = first[2] ?? "";
      }
      const attrs = parseAttrs(attrText);
      if (!attrs.pk) {
        diagnostics.push({
          line,
          message:
            "@table needs pk= (e.g. `@table AppTable pk=PK sk=SK`, or pk= alone for a PK-only table)",
          severity: "error",
        });
        return;
      }
      base = { name, pk: attrs.pk, sk: attrs.sk }; // sk absent -> PK-only
    } else if (kind === "ap") {
      // @ap <description>  [-> <Index> [get|query|scan] [key conditions]]
      const arrow = rest.indexOf("->");
      const description = (arrow >= 0 ? rest.slice(0, arrow) : rest).trim();
      if (description === "") {
        diagnostics.push({ line, message: "@ap needs a description", severity: "error" });
        return;
      }
      let index: string | undefined;
      let readOp: "get" | "query" | "scan" = "query";
      let keyText: string | undefined;
      if (arrow >= 0) {
        const t = parseApTail(rest.slice(arrow + 2));
        index = t.index;
        readOp = t.readOp;
        keyText = t.keyText;
        if (keyText && OLD_AP_KEY.test(keyText.replace(/\b(names|values|key)=\s*\{.*$/s, ""))) {
          diagnostics.push({
            line,
            message:
              readOp === "get"
                ? '@ap: a GetItem key is written as the API takes it: get key={"PK": {"S": "USER#1"}, "SK": {"S": "PROFILE"}}'
                : '@ap: write the query as the API takes it: PK = :u AND begins_with(SK, :o)  values={":u": {"S": "USER#1"}, ":o": {"S": "ORDER#"}}',
            severity: "warning",
          });
        }
      }
      aps.push({ n: aps.length + 1, description, index, readOp, keyText, line });
      apLines.push(line);
    } else {
      diagnostics.push({ line, message: `unknown directive @${kind}`, severity: "warning" });
    }
  });
  // No GSIs unless declared: a base-table-only model is valid (add @gsi when
  // an access pattern needs one).

  // Pass 2: item / delete lines. A comment directly above a line (no blank
  // line between) becomes that step's narration; a blank line clears it, so
  // header/section comments stay silent.
  let pending: string[] = [];
  const takeNote = (): string | undefined => {
    const note = pending.join(" ").trim();
    pending = [];
    return note || undefined;
  };

  // An open `@transact` block: its writes collect here, then land as ONE
  // step when `@end` closes it (all or nothing).
  let tx: { line: number; note?: string; actions: WriteAction[]; targets: string[] } | null = null;
  // The item a delete/check names, by its key (a deleted label keeps its last
  // key, so "delete x" then "check x" in one block is caught as the same item).
  const goneKey = new Map<string, string>();
  const keyFor = (id: string) => lastKey.get(id) ?? goneKey.get(id) ?? `id:${id}`;
  const emit = (op: Op, line: number, target: string[]) => {
    if (tx) {
      tx.actions.push(...(op.kind === "transact" ? op.actions : [op]));
      tx.targets.push(...target);
      return;
    }
    ops.push(op);
    notes.push(takeNote());
    opLines.push(line);
  };
  const closeTx = () => {
    if (!tx) return;
    const { line, actions, targets, note } = tx;
    tx = null;
    if (actions.length === 0) {
      diagnostics.push({ line, message: "@transact: empty transaction", severity: "warning" });
      return;
    }
    if (actions.length > TX_MAX) {
      diagnostics.push({
        line,
        message: `@transact: a transaction holds at most ${TX_MAX} actions (this one has ${actions.length})`,
        severity: "error",
      });
      return;
    }
    const dup = targets.find((t, i) => targets.indexOf(t) !== i);
    if (dup) {
      diagnostics.push({
        line,
        message:
          "@transact: ValidationException: Transaction request cannot include multiple operations on one item",
        severity: "error",
      });
      return;
    }
    ops.push({ kind: "transact", actions, explicit: true });
    notes.push(note);
    opLines.push(line);
  };

  lines.forEach((raw, line) => {
    const s = raw.trim();
    if (TX_OPEN.test(s)) {
      if (tx) {
        diagnostics.push({
          line,
          message: "@transact: transactions don't nest; close the open one with @end first",
          severity: "error",
        });
        return;
      }
      tx = { line, note: takeNote(), actions: [], targets: [] };
      return;
    }
    if (TX_END.test(s)) {
      if (!tx) {
        diagnostics.push({ line, message: "@end without an open @transact", severity: "error" });
        return;
      }
      closeTx();
      return;
    }
    if (s === "") {
      pending = [];
      return;
    }
    if (s.startsWith("#") || s.startsWith("//")) {
      pending.push(s.replace(/^(#+|\/\/)\s*/, ""));
      return;
    }
    if (s.startsWith("@")) {
      pending = [];
      return;
    }

    // A trailing `@if <expr> names={..} values={..}` guards the write (put or delete) with
    // a real DynamoDB ConditionExpression. It must be the LAST clause on the
    // line: everything after `@if` is the condition and its placeholders, so
    // their spaces and `=` never collide with the item's own key=value pairs.
    let condition: Condition | undefined;
    let core = s;
    const ifm = /\s@if\s+(.+)$/i.exec(s);
    if (ifm) {
      core = s.slice(0, ifm.index);
      const parsed = parseExpression(ifm[1], "condition");
      for (const message of parsed.warnings) {
        diagnostics.push({ line, message: `@if: ${message}`, severity: "warning" });
      }
      if (!parsed.expression) {
        // DynamoDB answers an invalid expression with a ValidationException:
        // the write never happens, so the line contributes no op.
        diagnostics.push({ line, message: `@if: ${parsed.error}`, severity: "error" });
        pending = [];
        return;
      }
      condition = parsed.expression;
    }

    const check = CHECK.exec(core);
    if (check) {
      if (!tx) {
        diagnostics.push({
          line,
          message: "check is a ConditionCheck: it only goes inside @transact … @end",
          severity: "error",
        });
        return;
      }
      if (!condition) {
        diagnostics.push({ line, message: "check needs an @if condition", severity: "error" });
        return;
      }
      tx.actions.push({ kind: "check", id: check[1], condition });
      tx.targets.push(keyFor(check[1]));
      return;
    }

    const del = DELETE.exec(core);
    if (del) {
      emit({ kind: "delete", id: del[1], condition }, line, [keyFor(del[1])]);
      goneKey.set(del[1], keyFor(del[1]));
      lastKey.delete(del[1]);
      return;
    }

    const m = LABEL.exec(core);
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

    for (const message of slips(attrs, base, gsis)) {
      diagnostics.push({ line, message, severity: "warning" });
    }

    const prevKey = lastKey.get(label);
    const target = newKey ?? `id:${label}`;
    if (prevKey && newKey && prevKey !== newKey) {
      // key changed -> atomic delete-old + put-new (a TransactWriteItems); the
      // guard rides the put action.
      emit(
        {
          kind: "transact",
          actions: [
            { kind: "delete", id: label },
            { kind: "put", item, condition },
          ],
        },
        line,
        [prevKey, target],
      );
    } else {
      emit({ kind: "put", item, condition }, line, [target]);
    }
    if (newKey) lastKey.set(label, newKey);
  });

  // A block still open at the end: keep what it holds (it may be mid-typing),
  // but say it needs closing.
  if (tx) {
    diagnostics.push({
      line: (tx as { line: number }).line,
      message: "@transact needs a closing @end",
      severity: "warning",
    });
    closeTx();
  }

  // An @ap naming an index that doesn't exist: say so on its line (the
  // directives can come in any order, so this waits until all are read).
  const indexNames = [base.name, ...gsis.map((g) => g.name)];
  aps.forEach((ap, i) => {
    if (ap.index && !indexNames.includes(ap.index)) {
      diagnostics.push({
        line: apLines[i],
        message: `@ap: index "${ap.index}" isn't defined (indexes: ${indexNames.join(", ")})`,
        severity: "warning",
      });
    }
  });

  return { ops, diagnostics, base, gsis, aps, notes, opLines };
}

/** Serialize access patterns back to `@ap` directive lines. */
export function serializeAps(aps: readonly AccessPattern[]): string {
  if (aps.length === 0) return "";
  return (
    aps
      .map((a) => {
        let s = `@ap ${a.description}`;
        if (a.index) {
          s += ` -> ${a.index}`;
          if (a.readOp && a.readOp !== "query") s += ` ${a.readOp}`;
          if (a.keyText) s += ` ${a.keyText}`;
        }
        return s;
      })
      .join("\n") + "\n"
  );
}

/** The whole model (structure + access patterns + data) as one DSL document. */
export function serializeModel(
  base: IndexSpec,
  gsis: readonly IndexSpec[],
  aps: readonly AccessPattern[],
  ops: readonly Op[],
): string {
  return (
    serializeTable(base) + serializeGsis(gsis) + serializeAps(aps) + "\n" + serializeOps(ops, base)
  );
}
