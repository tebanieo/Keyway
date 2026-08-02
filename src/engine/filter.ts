import type { Item } from "./types";

/**
 * A DynamoDB-style filter/condition expression: parser → AST → evaluator.
 * Supports the full grammar (comparators, BETWEEN, IN, the functions,
 * AND/OR/NOT, parentheses) against a flat item. Pure and self-contained.
 *
 * Values are written inline (no `:placeholder` / `#name` indirection): the LEFT
 * side of a comparison is an attribute path, the RIGHT side is a literal. Quote
 * a value (`"Ada Lovelace"`) if it contains spaces.
 */

export type CmpOp = "=" | "<>" | "<" | "<=" | ">" | ">=";

export type Operand =
  | { kind: "attr"; name: string }
  | { kind: "size"; attr: string }
  | { kind: "lit"; value: string };

export type FilterNode =
  | { kind: "and"; left: FilterNode; right: FilterNode }
  | { kind: "or"; left: FilterNode; right: FilterNode }
  | { kind: "not"; expr: FilterNode }
  | { kind: "cmp"; op: CmpOp; left: Operand; right: Operand }
  | { kind: "between"; op: Operand; low: Operand; high: Operand }
  | { kind: "in"; op: Operand; list: Operand[] }
  | { kind: "exists"; attr: string; negate: boolean }
  | { kind: "type"; attr: string; type: string }
  | { kind: "begins"; attr: string; value: Operand }
  | { kind: "contains"; attr: string; value: Operand };

// ---- tokenizer -------------------------------------------------------------

interface Tok {
  t: "word" | "str" | "op" | "lparen" | "rparen" | "comma";
  v: string;
}

const WORD = /[\w#@.:/\-+]+/y;

function tokenize(src: string): Tok[] {
  const toks: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === " " || c === "\t" || c === "\n") {
      i++;
      continue;
    }
    if (c === "(") { toks.push({ t: "lparen", v: c }); i++; continue; }
    if (c === ")") { toks.push({ t: "rparen", v: c }); i++; continue; }
    if (c === ",") { toks.push({ t: "comma", v: c }); i++; continue; }
    if (c === '"' || c === "'") {
      let j = i + 1;
      let s = "";
      while (j < src.length && src[j] !== c) s += src[j++];
      if (j >= src.length) throw new Error("unterminated string");
      toks.push({ t: "str", v: s });
      i = j + 1;
      continue;
    }
    if (c === "<") {
      if (src[i + 1] === "=") { toks.push({ t: "op", v: "<=" }); i += 2; }
      else if (src[i + 1] === ">") { toks.push({ t: "op", v: "<>" }); i += 2; }
      else { toks.push({ t: "op", v: "<" }); i++; }
      continue;
    }
    if (c === ">") {
      if (src[i + 1] === "=") { toks.push({ t: "op", v: ">=" }); i += 2; }
      else { toks.push({ t: "op", v: ">" }); i++; }
      continue;
    }
    if (c === "=") { toks.push({ t: "op", v: "=" }); i++; continue; }
    WORD.lastIndex = i;
    const m = WORD.exec(src);
    if (!m || m.index !== i) throw new Error(`unexpected character "${c}"`);
    toks.push({ t: "word", v: m[0] });
    i = WORD.lastIndex;
  }
  return toks;
}

// ---- parser (recursive descent, DynamoDB precedence) -----------------------

const KEYWORDS = new Set(["and", "or", "not", "between", "in"]);
const BOOL_FUNCS = new Set([
  "attribute_exists",
  "attribute_not_exists",
  "attribute_type",
  "begins_with",
  "contains",
]);
const CMP_OPS = new Set(["=", "<>", "<", "<=", ">", ">="]);

class Parser {
  private p = 0;
  constructor(private toks: Tok[]) {}

  private peek(): Tok | undefined {
    return this.toks[this.p];
  }
  private isKw(kw: string): boolean {
    const t = this.peek();
    return !!t && t.t === "word" && t.v.toLowerCase() === kw;
  }
  private next(): Tok {
    const t = this.toks[this.p++];
    if (!t) throw new Error("unexpected end of expression");
    return t;
  }
  private expect(t: Tok["t"]): Tok {
    const tok = this.next();
    if (tok.t !== t) throw new Error(`expected ${t}, got "${tok.v}"`);
    return tok;
  }

  parse(): FilterNode {
    const node = this.parseOr();
    if (this.peek()) throw new Error(`unexpected "${this.peek()!.v}"`);
    return node;
  }

  private parseOr(): FilterNode {
    let left = this.parseAnd();
    while (this.isKw("or")) {
      this.p++;
      left = { kind: "or", left, right: this.parseAnd() };
    }
    return left;
  }
  private parseAnd(): FilterNode {
    let left = this.parseNot();
    while (this.isKw("and")) {
      this.p++;
      left = { kind: "and", left, right: this.parseNot() };
    }
    return left;
  }
  private parseNot(): FilterNode {
    if (this.isKw("not")) {
      this.p++;
      return { kind: "not", expr: this.parseNot() };
    }
    return this.parsePrimary();
  }

  private parsePrimary(): FilterNode {
    const t = this.peek();
    if (!t) throw new Error("expected a condition");
    if (t.t === "lparen") {
      this.p++;
      const e = this.parseOr();
      this.expect("rparen");
      return e;
    }
    // a boolean function?
    if (t.t === "word" && BOOL_FUNCS.has(t.v.toLowerCase()) && this.toks[this.p + 1]?.t === "lparen") {
      return this.parseFunction(t.v.toLowerCase());
    }
    return this.parseComparison();
  }

  private parseFunction(name: string): FilterNode {
    this.p++; // name
    this.expect("lparen");
    const attr = this.parseAttr();
    if (name === "attribute_exists") { this.expect("rparen"); return { kind: "exists", attr, negate: false }; }
    if (name === "attribute_not_exists") { this.expect("rparen"); return { kind: "exists", attr, negate: true }; }
    this.expect("comma");
    if (name === "attribute_type") {
      const type = this.expect("word").v.toUpperCase();
      this.expect("rparen");
      return { kind: "type", attr, type };
    }
    const value = this.parseValue();
    this.expect("rparen");
    if (name === "begins_with") return { kind: "begins", attr, value };
    return { kind: "contains", attr, value };
  }

  private parseComparison(): FilterNode {
    const left = this.parsePath();
    const t = this.peek();
    if (t && t.t === "op" && CMP_OPS.has(t.v)) {
      this.p++;
      return { kind: "cmp", op: t.v as CmpOp, left, right: this.parseValue() };
    }
    if (this.isKw("between")) {
      this.p++;
      const low = this.parseValue();
      if (!this.isKw("and")) throw new Error("expected AND in BETWEEN");
      this.p++;
      const high = this.parseValue();
      return { kind: "between", op: left, low, high };
    }
    if (this.isKw("in")) {
      this.p++;
      this.expect("lparen");
      const list: Operand[] = [this.parseValue()];
      while (this.peek()?.t === "comma") {
        this.p++;
        list.push(this.parseValue());
      }
      this.expect("rparen");
      return { kind: "in", op: left, list };
    }
    throw new Error(`expected a comparator after "${operandText(left)}"`);
  }

  // left side / function first arg — an attribute path or size(attr)
  private parsePath(): Operand {
    const t = this.next();
    if (t.t === "word" && t.v.toLowerCase() === "size" && this.peek()?.t === "lparen") {
      this.expect("lparen");
      const attr = this.expect("word").v;
      this.expect("rparen");
      return { kind: "size", attr };
    }
    if (t.t !== "word") throw new Error(`expected an attribute, got "${t.v}"`);
    if (KEYWORDS.has(t.v.toLowerCase())) throw new Error(`"${t.v}" is a keyword`);
    return { kind: "attr", name: t.v };
  }

  private parseAttr(): string {
    const t = this.expect("word");
    return t.v;
  }

  // right side / function value arg — a literal or size(attr)
  private parseValue(): Operand {
    const t = this.peek();
    if (t && t.t === "word" && t.v.toLowerCase() === "size" && this.toks[this.p + 1]?.t === "lparen") {
      this.p++;
      this.expect("lparen");
      const attr = this.expect("word").v;
      this.expect("rparen");
      return { kind: "size", attr };
    }
    const tok = this.next();
    if (tok.t !== "word" && tok.t !== "str") throw new Error(`expected a value, got "${tok.v}"`);
    return { kind: "lit", value: tok.v };
  }
}

function operandText(o: Operand): string {
  return o.kind === "attr" ? o.name : o.kind === "size" ? `size(${o.attr})` : o.value;
}

export interface ParsedFilter {
  ast?: FilterNode;
  error?: string;
}

export function parseFilter(text: string): ParsedFilter {
  const trimmed = text.trim();
  if (trimmed === "") return {};
  try {
    return { ast: new Parser(tokenize(trimmed)).parse() };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

// ---- evaluator -------------------------------------------------------------

const NUM = /^-?\d+(\.\d+)?$/;

/** Resolve an operand to a string value (or undefined if a path is missing). */
function resolve(o: Operand, item: Item): string | undefined {
  if (o.kind === "lit") return o.value;
  if (o.kind === "attr") return item.attrs[o.name];
  const v = item.attrs[o.attr]; // size(attr)
  return v === undefined ? undefined : String(v.length);
}

function compare(a: string | undefined, b: string | undefined, op: CmpOp): boolean {
  if (a === undefined || b === undefined) return false;
  if (NUM.test(a) && NUM.test(b)) {
    const x = Number(a);
    const y = Number(b);
    switch (op) {
      case "=": return x === y;
      case "<>": return x !== y;
      case "<": return x < y;
      case "<=": return x <= y;
      case ">": return x > y;
      case ">=": return x >= y;
    }
  }
  switch (op) {
    case "=": return a === b;
    case "<>": return a !== b;
    case "<": return a < b;
    case "<=": return a <= b;
    case ">": return a > b;
    case ">=": return a >= b;
  }
}

export function evalFilter(node: FilterNode, item: Item): boolean {
  switch (node.kind) {
    case "and": return evalFilter(node.left, item) && evalFilter(node.right, item);
    case "or": return evalFilter(node.left, item) || evalFilter(node.right, item);
    case "not": return !evalFilter(node.expr, item);
    case "cmp": return compare(resolve(node.left, item), resolve(node.right, item), node.op);
    case "between": {
      const v = resolve(node.op, item);
      return (
        compare(v, resolve(node.low, item), ">=") && compare(v, resolve(node.high, item), "<=")
      );
    }
    case "in": {
      const v = resolve(node.op, item);
      return node.list.some((l) => compare(v, resolve(l, item), "="));
    }
    case "exists": {
      const present = item.attrs[node.attr] !== undefined;
      return node.negate ? !present : present;
    }
    case "type": {
      // No explicit types yet, so infer: numeric-looking values report N, else S
      // — kept consistent with how `compare` orders them (real N/S/B typing is
      // backlogged). Fixes the "says S but sorts as a Number" contradiction.
      const v = item.attrs[node.attr];
      if (v === undefined) return false;
      return node.type === (NUM.test(v) ? "N" : "S");
    }
    case "begins": {
      const v = item.attrs[node.attr];
      const sub = resolve(node.value, item);
      return v !== undefined && sub !== undefined && v.startsWith(sub);
    }
    case "contains": {
      const v = item.attrs[node.attr];
      const sub = resolve(node.value, item);
      return v !== undefined && sub !== undefined && v.includes(sub);
    }
  }
}
