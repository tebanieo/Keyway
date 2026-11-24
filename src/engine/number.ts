/**
 * Keyway attributes are untyped text. A value is treated as a DynamoDB Number
 * (`N`) only when it's written as a canonical number: an optional `-`, no
 * leading zeros (`007` is an ID or a zip code, so it stays a String), an
 * optional fraction, and at most 38 significant digits, DynamoDB's limit.
 * Everything else is a String (`S`). Conditions, filters, key conditions,
 * item size, and sort order all use this one rule, so they agree.
 */
const CANONICAL = /^-?(0|[1-9]\d*)(\.\d+)?$/;

export function isNumber(value: string): boolean {
  if (!CANONICAL.test(value)) return false;
  const digits = value.replace(/^-/, "").replace(".", "").replace(/^0+/, "").replace(/0+$/, "");
  return digits.length <= 38;
}

/**
 * Order two key values the way DynamoDB orders a key: Numbers numerically,
 * Strings by their bytes (code-unit order matches UTF-8 byte order for the
 * BMP). A Number and a String can't share a typed key in DynamoDB; Keyway puts
 * them in a stable order rather than refusing.
 */
export function compareKeyValues(a: string, b: string): number {
  if (isNumber(a) && isNumber(b)) {
    const d = Number(a) - Number(b);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return a < b ? -1 : a > b ? 1 : 0;
}
