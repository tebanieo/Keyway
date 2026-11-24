import {
  type AttributeValue,
  type ExpressionKind,
  toAttributeValue,
  validateCompiled,
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
const PAIR = /\s+([#:][A-Za-z0-9_]+)=("(?:[^"\\]|\\.)*"|[^\s"#:]\S*)$/;

export function parseExpression(text: string, kind: ExpressionKind): ParsedExpression {
  let expression = text.trim();
  const names: Record<string, string> = {};
  const values: Record<string, AttributeValue> = {};
  const pairs: [string, string][] = [];
  for (let m = PAIR.exec(expression); m; m = PAIR.exec(expression)) {
    pairs.unshift([m[1], m[2]]);
    expression = expression.slice(0, m.index).trimEnd();
  }
  if (expression === "") return { error: "an expression is required", warnings: [] };

  for (const [ref, raw] of pairs) {
    const quoted = raw.startsWith('"');
    const literal = quoted ? (JSON.parse(raw) as string) : raw;
    const seen = ref.startsWith("#") ? ref in names : ref in values;
    if (seen) return { error: `${ref} is defined twice`, warnings: [] };
    if (ref.startsWith("#")) names[ref] = literal;
    else values[ref] = quoted ? { S: literal } : toAttributeValue(literal);
  }

  const error = validateCompiled({ expression, names, values }, kind);
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
