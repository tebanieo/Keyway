import init, {
  evaluateExpression,
  initSync,
  itemSize,
  validateExpression,
} from "../../wasm/pkg/keyway_extenddb.js";
import type { FilterNode, Operand } from "./filter";
import type { Item } from "./types";

/**
 * Bridge to ExtendDB's `extenddb-core`, compiled to WASM (see `wasm/`). It
 * gives Keyway real DynamoDB expression semantics instead of a re-implementation.
 *
 * Keyway's DSL writes values inline (`status=pending`), while DynamoDB keeps
 * names and values out of the expression (`#n0 = :v0`). `compile` does that
 * translation, so it's also the exact expression you would send to DynamoDB.
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

/** Translate Keyway's parsed expression into DynamoDB syntax with placeholders. */
export function compile(node: FilterNode): CompiledExpression {
  const names: Record<string, string> = {};
  const values: Record<string, AttributeValue> = {};
  const nameRef = new Map<string, string>();
  const valueRef = new Map<string, string>();

  const name = (attr: string): string => {
    let ref = nameRef.get(attr);
    if (!ref) {
      ref = `#n${nameRef.size}`;
      nameRef.set(attr, ref);
      names[ref] = attr;
    }
    return ref;
  };
  const value = (v: AttributeValue): string => {
    const id = JSON.stringify(v);
    let ref = valueRef.get(id);
    if (!ref) {
      ref = `:v${valueRef.size}`;
      valueRef.set(id, ref);
      values[ref] = v;
    }
    return ref;
  };
  const operand = (o: Operand): string =>
    o.kind === "attr"
      ? name(o.name)
      : o.kind === "size"
        ? `size(${name(o.attr)})`
        : value(toAttributeValue(o.value));

  const walk = (n: FilterNode): string => {
    switch (n.kind) {
      case "and":
        return `(${walk(n.left)} AND ${walk(n.right)})`;
      case "or":
        return `(${walk(n.left)} OR ${walk(n.right)})`;
      case "not":
        return `(NOT ${walk(n.expr)})`;
      case "cmp":
        return `${operand(n.left)} ${n.op} ${operand(n.right)}`;
      case "between":
        return `${operand(n.op)} BETWEEN ${operand(n.low)} AND ${operand(n.high)}`;
      case "in":
        return `${operand(n.op)} IN (${n.list.map(operand).join(", ")})`;
      case "exists":
        return `${n.negate ? "attribute_not_exists" : "attribute_exists"}(${name(n.attr)})`;
      case "type":
        return `attribute_type(${name(n.attr)}, ${value({ S: n.type })})`;
      case "begins":
        return `begins_with(${name(n.attr)}, ${operand(n.value)})`;
      case "contains":
        return `contains(${name(n.attr)}, ${operand(n.value)})`;
    }
  };

  return { expression: walk(node), names, values };
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

/** Does `node` hold against `item`, by ExtendDB's DynamoDB semantics? */
export function evaluate(node: FilterNode, item: Item): boolean {
  return evaluateCompiled(compile(node), item, "filter");
}

/** The item's size in bytes as DynamoDB counts it for capacity. */
export function sizeOf(item: Item): number {
  assertReady();
  return itemSize(JSON.stringify(toWireItem(item.attrs)));
}
