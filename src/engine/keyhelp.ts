import type { AttributeValue } from "./extenddb";
import { needsNamePlaceholder } from "./expression";
import type { KeySchema } from "./expression";
import { isNumber } from "./number";
import type { Expression, Item } from "./types";

/**
 * Help for writing requests against the model: the type each attribute holds
 * in the table, key-condition templates for every sort-key operator, and a
 * warning when a value's type can't match what the table holds.
 */

export type ScalarType = "S" | "N";

/**
 * The type each attribute holds across the table. Keyway attributes are text,
 * so a Number (`N`) is an attribute whose every value is written as a plain
 * number (see `number.ts`); anything else is a String (`S`).
 */
export function attributeTypes(items: Iterable<Item>): Map<string, ScalarType> {
  const seen = new Map<string, ScalarType>();
  for (const item of items) {
    for (const [attr, value] of Object.entries(item.attrs)) {
      const t: ScalarType = isNumber(value) ? "N" : "S";
      if (seen.get(attr) !== "S") seen.set(attr, t); // one String makes it S
    }
  }
  return seen;
}

/** The sort-key operators a KeyConditionExpression allows, as the API spells them. */
export const SORT_KEY_OPS = ["=", "<", "<=", ">", ">=", "BETWEEN", "begins_with"] as const;
export type SortKeyOp = (typeof SORT_KEY_OPS)[number];

/** What each operator does, for the panel's help. */
export const SORT_KEY_OP_HELP: Record<SortKeyOp, string> = {
  "=": "the sort key equals a value",
  "<": "sort keys below a value",
  "<=": "sort keys at or below a value",
  ">": "sort keys above a value",
  ">=": "sort keys at or above a value",
  BETWEEN: "sort keys in a range, both ends included",
  begins_with: "sort keys starting with a prefix (Strings only), e.g. ORDER#",
};

/** A request's key condition, in the API's three parts. */
export interface KeyRequest {
  expression: string;
  names: Record<string, string>;
  values: Record<string, AttributeValue>;
}

/**
 * A KeyConditionExpression for `schema`: equality on every partition key, and
 * optionally `op` on the first sort key. Values are typed from the table
 * (`types`) and kept from `keep` when the same placeholder is already filled
 * in, so switching operators doesn't lose what was typed.
 */
export function keyConditionRequest(
  schema: KeySchema,
  op: SortKeyOp | null,
  types: Map<string, ScalarType>,
  keep: Record<string, AttributeValue> = {},
): KeyRequest {
  const names: Record<string, string> = {};
  const values: Record<string, AttributeValue> = {};
  const ref = (attr: string, alias: string) => {
    if (!needsNamePlaceholder(attr)) return attr;
    names[`#${alias}`] = attr;
    return `#${alias}`;
  };
  const value = (placeholder: string, attr: string) => {
    const t = types.get(attr) ?? "S";
    const kept = keep[placeholder];
    values[placeholder] = kept && t in kept ? kept : t === "N" ? { N: "" } : { S: "" };
    return placeholder;
  };

  const many = schema.hash.length > 1;
  const clauses = schema.hash.map((attr, i) => {
    const alias = many ? `pk${i + 1}` : "pk";
    return `${ref(attr, alias)} = ${value(`:${alias}`, attr)}`;
  });

  const sk = schema.range[0];
  if (op && sk) {
    const k = ref(sk, "sk");
    if (op === "BETWEEN") {
      clauses.push(`${k} BETWEEN ${value(":sk1", sk)} AND ${value(":sk2", sk)}`);
    } else if (op === "begins_with") {
      clauses.push(`begins_with(${k}, ${value(":sk", sk)})`);
    } else {
      clauses.push(`${k} ${op} ${value(":sk", sk)}`);
    }
  }
  return { expression: clauses.join(" AND "), names, values };
}

/** A GetItem `Key` for `schema`, typed from the table, values to fill in. */
export function getKeyTemplate(
  schema: KeySchema,
  types: Map<string, ScalarType>,
): Record<string, AttributeValue> {
  const key: Record<string, AttributeValue> = {};
  for (const attr of [...schema.hash, ...schema.range]) {
    key[attr] = types.get(attr) === "N" ? { N: "" } : { S: "" };
  }
  return key;
}

// `attr op :v`, `:v op attr`, `begins_with(attr, :v)`, `attr BETWEEN :a AND :b`.
const PAIRINGS = [
  /([#\w.]+)\s*(?:<>|<=|>=|=|<|>)\s*(:\w+)/g,
  /begins_with\(\s*([#\w.]+)\s*,\s*(:\w+)\s*\)/gi,
  /contains\(\s*([#\w.]+)\s*,\s*(:\w+)\s*\)/gi,
  /([#\w.]+)\s+BETWEEN\s+(:\w+)\s+AND\s+(:\w+)/gi,
];

/**
 * Warn where a value's type can't match what the table holds: DynamoDB
 * compares by type, so `GSI1SK = :d` with `:d` a String finds nothing when
 * GSI1SK holds Numbers. Approximate (it reads the expression's text), so it
 * only ever warns.
 */
export function typeMismatches(expr: Expression, types: Map<string, ScalarType>): string[] {
  const out = new Set<string>();
  const name = { S: "a String (S)", N: "a Number (N)" };
  for (const re of PAIRINGS) {
    for (const m of expr.expression.matchAll(re)) {
      const ref = m[1];
      const attr = ref.startsWith("#") ? expr.names[ref] : ref;
      const held = attr ? types.get(attr) : undefined;
      if (!held) continue;
      for (const placeholder of m.slice(2).filter(Boolean)) {
        const v = expr.values[placeholder];
        const t = v ? (Object.keys(v)[0] as string) : undefined;
        if ((t === "S" || t === "N") && t !== held) {
          out.add(
            `${attr} holds ${held === "N" ? "Numbers (N)" : "Strings (S)"} in this table, but ${placeholder} is ${name[t]}: DynamoDB compares by type, so it won't match`,
          );
        }
      }
    }
  }
  return [...out];
}
