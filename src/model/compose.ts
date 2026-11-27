/**
 * The guided "Add" forms write ordinary script lines: what they show as a
 * preview is exactly what lands in the script, so the form teaches the text.
 */

const SP2 = "  ";
const list = (s: string) =>
  s
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);

export interface IndexForm {
  name: string;
  pk: string; // one attribute, or a comma list (multi-key)
  sk: string;
  projection: "all" | "keys" | "include";
  include: string; // comma list when projection is "include"
}

/** `@gsi GSI2 pk=… sk=… projection=…` */
export function indexLine(f: IndexForm): string {
  const parts = [`@gsi ${f.name.trim() || "GSI"}`, `pk=${list(f.pk).join(",")}`];
  if (list(f.sk).length) parts.push(`sk=${list(f.sk).join(",")}`);
  const proj = f.projection === "include" ? list(f.include).join(",") || "keys" : f.projection;
  if (proj !== "all") parts.push(`projection=${proj}`);
  return parts.join(" ");
}

export interface EntityForm {
  type: string;
  /** Key values, literal or templated: `USER#{userId}`, `ORDER#{date}#{id}`. */
  keys: Record<string, string>;
  /** Other attributes, comma-separated. */
  attrs: string;
}

const PLACE = /\{([A-Za-z_]\w*)\}/g;
const HAS_PLACE = /\{[A-Za-z_]\w*\}/;

/**
 * A `@key` line for the templated keys (if any) and a first item to fill in.
 * Attributes a template reads get `<name>` stand-ins, so the derived key
 * shows where each value goes until you type the real one.
 */
export function entityLines(f: EntityForm, label: string): string[] {
  const type = f.type.trim() || "entity";
  const keys = Object.entries(f.keys).filter(([, v]) => v.trim());
  const templated = keys.filter(([, v]) => HAS_PLACE.test(v));
  const literal = keys.filter(([, v]) => !HAS_PLACE.test(v));
  const reads = [...new Set(templated.flatMap(([, v]) => [...v.matchAll(PLACE)].map((m) => m[1])))];
  const others = list(f.attrs).filter((a) => !reads.includes(a));
  const out: string[] = [];
  if (templated.length) {
    out.push([`@key ${type}`, ...templated.map(([k, v]) => `${k}=${v.trim()}`)].join(SP2));
  }
  const pairs = [
    ...literal.map(([k, v]) => `${k}=${v.trim()}`),
    ...reads.map((a) => `${a}=<${a}>`),
    ...others.map((a) => `${a}=<${a}>`),
    `_type=${type}`,
  ];
  out.push(`${label}: ${pairs.join(SP2)}`);
  return out;
}
