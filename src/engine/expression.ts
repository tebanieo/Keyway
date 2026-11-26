import {
  type AttributeValue,
  type ExpressionKind,
  validateCompiled,
  validateKeyCompiled,
} from "./extenddb";
import type { Expression } from "./types";

/**
 * Real DynamoDB expressions, written the way the API, the CLI, and the SDKs
 * take them: the expression, plus its ExpressionAttributeNames and
 * ExpressionAttributeValues as JSON, values typed (`{"S": "…"}`, `{"N": "…"}`).
 *
 *     attribute_not_exists(PK) OR #s = :s  names={"#s":"status"} values={":s":{"S":"pending"}}
 *
 * On one DSL line, `names=` and `values=` follow the expression; the Query
 * panel has a field for each, as the API does. ExtendDB validates the result
 * exactly as DynamoDB would: reserved words, syntax, undefined and unused
 * placeholders, and (for a KeyConditionExpression) the index's key rules.
 */
export interface ParsedExpression {
  expression?: Expression;
  error?: string;
  /** Valid DynamoDB that probably isn't what was meant. */
  warnings: string[];
}

/** An index's key schema: its partition and sort key attributes, in order. */
export interface KeySchema {
  hash: string[];
  range: string[];
}

// `#s=status` or `:p= open` left in the expression text (no space before `=`).
// A compact but valid `#a=:v` (value starts with `:`/`#`) isn't one.
const OLD_PAIR = /(?:^|\s)([#:][A-Za-z0-9_]+)=\s*([^\s"{:#][^\s]*)/;

/** The parts of a request, as the API takes them. */
export interface ExpressionParts {
  expression: string;
  names?: unknown;
  values?: unknown;
}

const TYPES = new Set(["S", "N", "B", "BOOL", "NULL", "L", "M", "SS", "NS", "BS"]);

/** Check ExpressionAttributeNames/Values have the API's shape. */
function checkMaps(
  names: unknown,
  values: unknown,
): { names: Record<string, string>; values: Record<string, AttributeValue> } | string {
  const isObject = (v: unknown): v is Record<string, unknown> =>
    typeof v === "object" && v !== null && !Array.isArray(v);
  const n = names ?? {};
  const v = values ?? {};
  if (!isObject(n)) return 'ExpressionAttributeNames must be an object, e.g. {"#s": "status"}';
  if (!isObject(v)) {
    return 'ExpressionAttributeValues must be an object, e.g. {":v": {"S": "pending"}}';
  }
  for (const [k, attr] of Object.entries(n)) {
    if (!k.startsWith("#")) return `ExpressionAttributeNames: "${k}" must start with #`;
    if (typeof attr !== "string") return `ExpressionAttributeNames: "${k}" must name an attribute`;
  }
  for (const [k, av] of Object.entries(v)) {
    if (!k.startsWith(":")) return `ExpressionAttributeValues: "${k}" must start with :`;
    const typeKeys = isObject(av) ? Object.keys(av) : [];
    if (typeKeys.length !== 1 || !TYPES.has(typeKeys[0])) {
      return `ExpressionAttributeValues: "${k}" must be a typed value, e.g. {"S": "ORDER#1"} or {"N": "42"}`;
    }
  }
  return { names: n as Record<string, string>, values: v as Record<string, AttributeValue> };
}

/**
 * Validate an expression given as the API's separate parts (the Query panel's
 * fields). `kind: "key"` takes the queried index's `schema`.
 */
export function compileExpression(
  parts: ExpressionParts,
  kind: ExpressionKind,
  schema?: KeySchema,
): ParsedExpression {
  const expression = parts.expression.trim();
  if (expression === "") return { error: "an expression is required", warnings: [] };
  // Catch the pre-API `#s=status :p=open` pairs before ExtendDB does: it would
  // read `status` as an attribute and report a puzzling reserved keyword.
  const pair = OLD_PAIR.exec(expression);
  if (pair) {
    const [, ref, value] = pair;
    const fix = ref.startsWith("#")
      ? `names={"${ref}": "${value}"}`
      : `values={"${ref}": {"S": "${value}"}}`;
    return {
      error: `"${ref}=${value}" isn't part of an expression: write it as ${fix}, as the API takes it`,
      warnings: [],
    };
  }
  const maps = checkMaps(parts.names, parts.values);
  if (typeof maps === "string") return { error: maps, warnings: [] };
  const { names, values } = maps;

  if (kind === "key") {
    // A key attribute can't be compared with an empty value. Checked here,
    // because the fresh templates start with empty values to fill in.
    const empty = Object.entries(values).find(
      ([, av]) => "S" in av && (av as { S: string }).S === "",
    );
    if (empty) return { error: `${empty[0]} is empty: fill in its value`, warnings: [] };
  }

  const compiled = { expression, names, values };
  const error =
    kind === "key" && schema
      ? validateKeyCompiled(compiled, schema.hash, schema.range)
      : validateCompiled(compiled, kind);
  if (error) return { error, warnings: [] };
  return {
    expression: { expression, names, values, text: render(parts) },
    warnings: bareComparisons(expression),
  };
}

/** The one-line form: `expr [names={…}] [values={…}]`. */
function render(parts: ExpressionParts): string {
  const n = parts.names && Object.keys(parts.names).length ? parts.names : undefined;
  const v = parts.values && Object.keys(parts.values).length ? parts.values : undefined;
  return [
    parts.expression.trim(),
    n && `names=${JSON.stringify(n)}`,
    v && `values=${JSON.stringify(v)}`,
  ]
    .filter(Boolean)
    .join("  ");
}

/**
 * Split `expr names={…} values={…}` (also `key={…}` for a GetItem) into its
 * expression and JSON clauses. The clauses come last; their JSON may hold
 * spaces and `=`, so each is read by matching braces, not by splitting.
 */
export function splitClauses(
  text: string,
  allowed: readonly string[],
): { expression: string; clauses: Record<string, unknown> } | { error: string } {
  const start = new RegExp(`(^|\\s)(${allowed.join("|")})=\\s*\\{`, "g");
  for (const m of text.matchAll(start)) {
    const at = m.index + m[1].length;
    const clauses = readClauses(text.slice(at), allowed);
    if (clauses === null) continue; // not where the clauses begin; try the next
    if (typeof clauses === "string") return { error: clauses };
    return { expression: text.slice(0, at).trim(), clauses };
  }
  return { expression: text.trim(), clauses: {} };
}

/** Read `name={json} name={json}` to the end, or null if `rest` isn't that. */
function readClauses(
  rest: string,
  allowed: readonly string[],
): Record<string, unknown> | string | null {
  const out: Record<string, unknown> = {};
  let i = 0;
  while (i < rest.length) {
    const m = /^\s*([a-z]+)=\s*/.exec(rest.slice(i));
    if (!m || !allowed.includes(m[1])) return null;
    i += m[0].length;
    const end = matchBrace(rest, i);
    if (end < 0) return `${m[1]}= needs a complete JSON object, e.g. ${m[1]}={…}`;
    try {
      out[m[1]] = JSON.parse(rest.slice(i, end + 1));
    } catch (e) {
      return `${m[1]}= isn't valid JSON: ${e instanceof Error ? e.message : String(e)}`;
    }
    i = end + 1;
    while (i < rest.length && /\s/.test(rest[i])) i++;
  }
  return out;
}

/** Index of the `}` closing the `{` at `from`, honoring JSON strings; -1 if none. */
function matchBrace(s: string, from: number): number {
  if (s[from] !== "{") return -1;
  let depth = 0;
  for (let i = from; i < s.length; i++) {
    const c = s[i];
    if (c === '"') {
      for (i++; i < s.length && s[i] !== '"'; i++) if (s[i] === "\\") i++;
    } else if (c === "{" || c === "[") depth++;
    else if (c === "}" || c === "]") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/**
 * Parse the one-line form used on DSL lines (`@if`, `@ap`):
 * `expr [names={…}] [values={…}]`.
 */
export function parseExpression(
  text: string,
  kind: ExpressionKind,
  schema?: KeySchema,
): ParsedExpression {
  const split = splitClauses(text, ["names", "values"]);
  if ("error" in split) return { error: split.error, warnings: [] };
  return compileExpression(
    { expression: split.expression, names: split.clauses.names, values: split.clauses.values },
    kind,
    schema,
  );
}

// `status = pending` is valid DynamoDB, but it compares two ATTRIBUTES. That's
// rarely intended, and it's what Keyway's old inline syntax meant by a value.
const BARE_CMP = /(?:<>|<=|>=|=|<|>)\s*([A-Za-z_][A-Za-z0-9_.]*)\b(?!\s*\()/g;

function bareComparisons(expression: string): string[] {
  return [...expression.matchAll(BARE_CMP)].map(
    ([, word]) =>
      `\`${word}\` is read as an attribute name; for a literal value, use a placeholder like :v and put it in values={":v": {"S": "${word}"}}`,
  );
}

/** Whether `attr` must be written through a `#name` placeholder: a DynamoDB
 *  reserved word, or not a plain identifier. Asks ExtendDB, not a word list. */
export function needsNamePlaceholder(attr: string): boolean {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(attr)) return true;
  const probe = { expression: `${attr} = :v`, names: {}, values: { ":v": { S: "x" } } };
  return validateCompiled(probe, "condition") !== null;
}
