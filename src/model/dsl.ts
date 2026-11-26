import { keyOf } from "../engine/engine";
import { parseExpression, splitClauses } from "../engine/expression";
import type { AttributeValue } from "../engine/extenddb";
import type { Condition, IndexSpec, Item, Op, ProjectionSpec } from "../engine/types";

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
 * Serialize ops back to DSL text: the inverse of parseDoc (modulo comments and
 * spacing). Used when opening the editor on a model that was built by direct
 * manipulation, so text and grid stay one source of truth. A transact renders
 * as its put line: re-parsing that line against the prior key re-derives the
 * transaction, so the round-trip is stable.
 */
export function serializeOps(ops: readonly Op[], baseIndex: IndexSpec): string {
  const guard = (c: Condition | undefined) => (c ? `${SP}${SP}@if${SP}${c.text}` : "");
  const lines = ops.map((op) => {
    if (op.kind === "delete") return `delete${SP}${op.id}${guard(op.condition)}`;
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
      aps.push({ n: aps.length + 1, description, index, readOp, keyText });
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

  lines.forEach((raw, line) => {
    const s = raw.trim();
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

    const del = DELETE.exec(core);
    if (del) {
      ops.push({ kind: "delete", id: del[1], condition });
      notes.push(takeNote());
      opLines.push(line);
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

    const prevKey = lastKey.get(label);
    if (prevKey && newKey && prevKey !== newKey) {
      // key changed -> atomic delete-old + put-new (a TransactWriteItems); the
      // guard rides the put action.
      ops.push({
        kind: "transact",
        actions: [
          { kind: "delete", id: label },
          { kind: "put", item, condition },
        ],
      });
    } else {
      ops.push({ kind: "put", item, condition });
    }
    notes.push(takeNote());
    opLines.push(line);
    if (newKey) lastKey.set(label, newKey);
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
