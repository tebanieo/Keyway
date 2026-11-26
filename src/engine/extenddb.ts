import init, {
  evaluateExpression,
  initSync,
  itemSize,
  validateExpression,
  validateKeyCondition,
} from "../../wasm/pkg/keyway_extenddb.js";
import { isNumber } from "./number";
import type { Item } from "./types";

/**
 * Bridge to ExtendDB's `extenddb-core`, compiled to WASM (see `wasm/`). It
 * gives Keyway real DynamoDB expression semantics instead of a re-implementation.
 *
 * Expressions arrive already in DynamoDB form (see `parseExpression`), so they
 * are exactly what you would send to DynamoDB.
 *
 * Keyway attributes are untyped strings; a canonical number is sent as a
 * Number (`N`), anything else as a String (`S`), by the rule in `number.ts`
 * that sorting and sizing share.
 */

let ready = false;

/** Load the WASM module. Pass the `.wasm` bytes where `fetch` can't reach it (tests). */
export async function initExtendDB(bytes?: BufferSource): Promise<void> {
  if (ready) return;
  if (bytes) initSync({ module: bytes });
  else await init();
  ready = true;
}

function assertReady(): void {
  if (!ready) throw new Error("ExtendDB WASM isn't loaded yet: call initExtendDB() first");
}

/** A DynamoDB-typed value, as the API writes it: `{"S": "x"}`, `{"N": "1"}`, … */
export type AttributeValue =
  { S: string } | { N: string } | { BOOL: boolean } | { NULL: true } | { [type: string]: unknown };

/** One Keyway value as DynamoDB wire JSON. */
export function toAttributeValue(value: string): { S: string } | { N: string } {
  return isNumber(value) ? { N: value } : { S: value };
}

/** A Keyway item's attributes as a DynamoDB wire item. */
export function toWireItem(
  attrs: Record<string, string>,
): Record<string, { S: string } | { N: string }> {
  const out: Record<string, { S: string } | { N: string }> = {};
  for (const [k, v] of Object.entries(attrs)) out[k] = toAttributeValue(v);
  return out;
}

/** A DynamoDB expression with its placeholder maps, ready to send. */
export interface CompiledExpression {
  expression: string;
  names: Record<string, string>;
  values: Record<string, AttributeValue>;
}

/**
 * Which request parameter an expression is. They share one grammar, but
 * DynamoDB labels their errors differently; a FilterExpression also gets
 * Query/Scan's `begins_with` operand check, and a KeyConditionExpression is
 * restricted to the index's keys (see `validateKeyCompiled`).
 */
export type ExpressionKind = "condition" | "filter" | "key";

/** DynamoDB's ValidationException message for `c`, or null when it's valid. */
export function validateCompiled(c: CompiledExpression, kind: ExpressionKind): string | null {
  assertReady();
  try {
    validateExpression(kind, c.expression, JSON.stringify(c.names), JSON.stringify(c.values));
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

/**
 * DynamoDB's error for KeyConditionExpression `c` on an index with partition
 * key attributes `hash` and sort key attributes `range` (several, for a
 * multi-attribute key), or null when it's a valid Query.
 */
export function validateKeyCompiled(
  c: CompiledExpression,
  hash: string[],
  range: string[],
): string | null {
  assertReady();
  try {
    validateKeyCondition(
      c.expression,
      JSON.stringify(c.names),
      JSON.stringify(c.values),
      JSON.stringify(hash),
      JSON.stringify(range),
    );
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

/** Does `c` hold against `item`, by ExtendDB's DynamoDB semantics? `c` should
 *  come from `parseExpression`, which validated it; this never throws. */
export function evaluateCompiled(c: CompiledExpression, item: Item, kind: ExpressionKind): boolean {
  assertReady();
  try {
    return evaluateExpression(
      kind,
      c.expression,
      JSON.stringify(toWireItem(item.attrs)),
      JSON.stringify(c.names),
      JSON.stringify(c.values),
    );
  } catch {
    // Validation (parseExpression) already caught every mistake in the
    // expression itself. What's left depends on the item's data, e.g.
    // `begins_with(a, b)` where attribute b holds a Number: DynamoDB treats a
    // wrongly typed attribute operand as a false comparison, not an error. So
    // the clause doesn't hold, and the app never crashes mid-render.
    return false;
  }
}

/** The item's size in bytes as DynamoDB counts it for capacity. */
export function sizeOf(item: Item): number {
  assertReady();
  return itemSize(JSON.stringify(toWireItem(item.attrs)));
}
