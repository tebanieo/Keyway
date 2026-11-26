import type { AttributeValue } from "../engine/extenddb";

/**
 * A read request as the DynamoDB API takes it, and the AWS CLI command that
 * sends it. Pure; used by the Query panel.
 */
export interface ReadRequest {
  op: "get" | "query" | "scan";
  tableName: string;
  /** Set when reading a GSI. */
  indexName?: string;
  /** GetItem's Key. */
  key?: Record<string, AttributeValue>;
  keyConditionExpression?: string;
  filterExpression?: string;
  names?: Record<string, string>;
  values?: Record<string, AttributeValue>;
  consistentRead?: boolean;
}

const REF = /[#:][A-Za-z0-9_]+/g;

/** The `#names` and `:values` an expression refers to. */
export function refsIn(expression: string): { names: Set<string>; values: Set<string> } {
  const names = new Set<string>();
  const values = new Set<string>();
  for (const [ref] of expression.matchAll(REF)) (ref[0] === "#" ? names : values).add(ref);
  return { names, values };
}

/** Only the entries of `map` whose keys are in `keep`. */
export function pick<T>(map: Record<string, T>, keep: Set<string>): Record<string, T> {
  return Object.fromEntries(Object.entries(map).filter(([k]) => keep.has(k)));
}

/**
 * The API's request-wide rule: every ExpressionAttributeNames/Values entry must
 * be used by one of the request's expressions. Returns DynamoDB's message for
 * the first one that isn't, or null.
 */
export function unusedAcross(
  expressions: string[],
  names: Record<string, string>,
  values: Record<string, AttributeValue>,
): string | null {
  const used = expressions.map(refsIn);
  const n = Object.keys(names).find((k) => !used.some((u) => u.names.has(k)));
  if (n) return `Value provided in ExpressionAttributeNames unused in expressions: keys: {${n}}`;
  const v = Object.keys(values).find((k) => !used.some((u) => u.values.has(k)));
  if (v) return `Value provided in ExpressionAttributeValues unused in expressions: keys: {${v}}`;
  return null;
}

/** Quote for a POSIX shell: single quotes, with `'` written as `'\''`. */
function sh(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

const json = (v: unknown) => JSON.stringify(v);

/** The `aws dynamodb …` command that sends `req`, one option per line. */
export function cliCommand(req: ReadRequest): string {
  const cmd = req.op === "get" ? "get-item" : req.op;
  const lines = [`aws dynamodb ${cmd}`, `--table-name ${sh(req.tableName)}`];
  if (req.indexName && req.op !== "get") lines.push(`--index-name ${sh(req.indexName)}`);
  if (req.op === "get" && req.key) lines.push(`--key ${sh(json(req.key))}`);
  if (req.op === "query" && req.keyConditionExpression) {
    lines.push(`--key-condition-expression ${sh(req.keyConditionExpression)}`);
  }
  if (req.op !== "get" && req.filterExpression) {
    lines.push(`--filter-expression ${sh(req.filterExpression)}`);
  }
  if (req.op !== "get" && req.names && Object.keys(req.names).length) {
    lines.push(`--expression-attribute-names ${sh(json(req.names))}`);
  }
  if (req.op !== "get" && req.values && Object.keys(req.values).length) {
    lines.push(`--expression-attribute-values ${sh(json(req.values))}`);
  }
  if (req.consistentRead) lines.push("--consistent-read");
  return lines.join(" \\\n  ");
}
