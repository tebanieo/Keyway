import {
  type AttributeValue,
  type ExpressionKind,
  toAttributeValue,
  validateCompiled,
  validateKeyCompiled,
} from "./extenddb";
import type { Expression } from "./types";

/**
 * Parse a real DynamoDB expression written Keyway-style: the expression,
 * followed by its placeholders as `#name=attr` / `:value=literal` pairs. Used
 * for `@if` (a ConditionExpression) and the Query panel's FilterExpression.
 *
 *     attribute_not_exists(PK) OR #s = :s   #s=status :s=pending
 *
 * A bare value that looks like a number is a Number (`N`), anything else a
 * String (`S`); quote it (`:v="42"`, `:v="Ada Lovelace"`) to force a String or
 * include spaces. The expression is validated by ExtendDB exactly as PutItem
 * would: reserved words, syntax, undefined and unused placeholders.
 */
export interface ParsedExpression {
  expression?: Expression;
  error?: string;
  /** Valid DynamoDB that probably isn't what was meant. */
  warnings: string[];
}

// One trailing pair. Its value can't start with `#`/`:`, so a compact
// `#s=:s` stays part of the expression instead of being read as a pair.
const PAIR = /\s+([#:][A-Za-z0-9_]+)=("(?:[^"\\]|\\.)*"|[^\s"#:]\S*)?$/;

/** An index's key schema: its partition and sort key attributes, in order. */
export interface KeySchema {
  hash: string[];
  range: string[];
}

/**
 * Parse `text` as `kind`. A KeyConditionExpression is only meaningful against
 * an index, so `kind: "key"` takes that index's `schema` and is validated
 * against it.
 */
export function parseExpression(
  text: string,
  kind: ExpressionKind,
  schema?: KeySchema,
): ParsedExpression {
  let expression = text.trim();
  const names: Record<string, string> = {};
  const values: Record<string, AttributeValue> = {};
  const pairs: [string, string | undefined][] = [];
  for (let m = PAIR.exec(expression); m; m = PAIR.exec(expression)) {
    pairs.unshift([m[1], m[2]]);
    expression = expression.slice(0, m.index).trimEnd();
  }
  if (expression === "") return { error: "an expression is required", warnings: [] };

  for (const [ref, raw] of pairs) {
    if (raw === undefined) {
      return { error: `${ref} needs a value, e.g. ${ref}=USER#1`, warnings: [] };
    }
    const quoted = raw.startsWith('"');
    let literal = raw;
    if (quoted) {
      try {
        literal = JSON.parse(raw) as string;
      } catch {
        return {
          error: `${ref} has an invalid quoted value; inside quotes, write a backslash as \\\\ and a quote as \\"`,
          warnings: [],
        };
      }
    }
    const seen = ref.startsWith("#") ? ref in names : ref in values;
    if (seen) return { error: `${ref} is defined twice`, warnings: [] };
    if (ref.startsWith("#")) names[ref] = literal;
    else values[ref] = quoted ? { S: literal } : toAttributeValue(literal);
  }

  const compiled = { expression, names, values };
  const error =
    kind === "key" && schema
      ? validateKeyCompiled(compiled, schema.hash, schema.range)
      : validateCompiled(compiled, kind);
  if (error) return { error, warnings: [] };
  return {
    expression: { expression, names, values, text: text.trim() },
    warnings: bareComparisons(expression),
  };
}

// `status = pending` is valid DynamoDB, but it compares two ATTRIBUTES. That's
// rarely intended, and it's what Keyway's old inline syntax meant by a value.
const BARE_CMP = /(?:<>|<=|>=|=|<|>)\s*([A-Za-z_][A-Za-z0-9_.]*)\b(?!\s*\()/g;

function bareComparisons(expression: string): string[] {
  return [...expression.matchAll(BARE_CMP)].map(
    ([, word]) =>
      `\`${word}\` is read as an attribute name; for a literal value, use a placeholder like :v and add :v=${word}`,
  );
}

/** Whether `attr` must be written through a `#name` placeholder: a DynamoDB
 *  reserved word, or not a plain identifier. Asks ExtendDB, not a word list. */
export function needsNamePlaceholder(attr: string): boolean {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(attr)) return true;
  const probe = { expression: `${attr} = :v`, names: {}, values: { ":v": { S: "x" } } };
  return validateCompiled(probe, "condition") !== null;
}

/** A starting KeyConditionExpression for `schema`: equality on every partition
 *  key attribute, values left for the user to fill in (`PK = :pk  :pk=`). */
export function keyConditionTemplate(schema: KeySchema): string {
  const clauses: string[] = [];
  const names: string[] = [];
  const values: string[] = [];
  schema.hash.forEach((attr, i) => {
    const v = schema.hash.length > 1 ? `:pk${i + 1}` : ":pk";
    let ref = attr;
    if (needsNamePlaceholder(attr)) {
      ref = schema.hash.length > 1 ? `#pk${i + 1}` : "#pk";
      names.push(`${ref}=${attr}`);
    }
    clauses.push(`${ref} = ${v}`);
    values.push(`${v}=`);
  });
  return [clauses.join(" AND "), [...names, ...values].join(" ")].join("  ");
}
