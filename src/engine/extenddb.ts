import init, {
  evaluateExpression,
  initSync,
  itemSize,
  validateExpression,
} from "../../wasm/pkg/keyway_extenddb.js";
import type { Item } from "./types";

/**
 * Bridge to ExtendDB's `extenddb-core`, compiled to WASM (see `wasm/`). It
 * gives Keyway real DynamoDB expression semantics instead of a re-implementation.
 *
 * Expressions arrive already in DynamoDB form (see `parseExpression`), so they
 * are exactly what you would send to DynamoDB.
 *
 * Keyway attributes are untyped strings; a numeric-looking value is sent as a
 * Number (`N`), anything else as a String (`S`), matching how Keyway sorts.
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

export type AttributeValue = { S: string } | { N: string };

const NUM = /^-?\d+(\.\d+)?$/;

/** One Keyway value as DynamoDB wire JSON. */
export function toAttributeValue(value: string): AttributeValue {
  return NUM.test(value) ? { N: value } : { S: value };
}

/** A Keyway item's attributes as a DynamoDB wire item. */
export function toWireItem(attrs: Record<string, string>): Record<string, AttributeValue> {
  const out: Record<string, AttributeValue> = {};
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
 * DynamoDB labels their errors differently, and a FilterExpression also gets
 * Query/Scan's `begins_with` operand check.
 */
export type ExpressionKind = "condition" | "filter";

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

/** Does `c` hold against `item`, by ExtendDB's DynamoDB semantics? Throws a
 *  DynamoDB-style validation message when the expression is invalid. */
export function evaluateCompiled(c: CompiledExpression, item: Item, kind: ExpressionKind): boolean {
  assertReady();
  return evaluateExpression(
    kind,
    c.expression,
    JSON.stringify(toWireItem(item.attrs)),
    JSON.stringify(c.names),
    JSON.stringify(c.values),
  );
}

/** The item's size in bytes as DynamoDB counts it for capacity. */
export function sizeOf(item: Item): number {
  assertReady();
  return itemSize(JSON.stringify(toWireItem(item.attrs)));
}
