import { TYPE_ATTR } from "./entities";

/**
 * Key templates: `@key order  SK=ORDER#{date}#{id}  GSI1SK={date}`.
 *
 * In single-table design a key is composed from the item's own attributes.
 * A template says how, once per entity type, and every item tagged
 * `_type=order` gets its keys filled in from its attributes (after the whole
 * line is read, so attributes can come in any order). One edit to the
 * template re-keys every item of that type.
 */

/** attribute -> template, e.g. { SK: "ORDER#{date}#{id}" } */
export type KeyTemplate = Record<string, string>;
/** entity type -> its template */
export type KeyTemplates = Map<string, KeyTemplate>;

const PLACEHOLDER = /\{([A-Za-z_]\w*)\}/g;

/** The attribute names a template reads, in order. */
export function placeholders(template: string): string[] {
  return [...template.matchAll(PLACEHOLDER)].map((m) => m[1]);
}

/** Fill a template from an item's attributes, or name what's missing. */
export function fill(
  template: string,
  attrs: Record<string, string>,
): { value: string } | { missing: string[] } {
  const missing = placeholders(template).filter((p) => attrs[p] === undefined);
  if (missing.length) return { missing };
  return { value: template.replace(PLACEHOLDER, (_, p: string) => attrs[p]) };
}

/**
 * Derive an item's templated keys in place. Returns notes for the editor: an
 * attribute the template needs but the item lacks, or an explicit key that
 * disagrees with its template (the explicit value is kept).
 */
export function applyTemplates(
  label: string,
  attrs: Record<string, string>,
  templates: KeyTemplates,
): string[] {
  const type = attrs[TYPE_ATTR];
  const t = type ? templates.get(type) : undefined;
  if (!t) return [];
  const notes: string[] = [];
  for (const [attr, template] of Object.entries(t)) {
    const r = fill(template, attrs);
    if ("missing" in r) {
      if (attrs[attr] === undefined) {
        notes.push(
          `${label} needs ${r.missing.map((m) => `\`${m}\``).join(", ")} for ${attr} (from @key ${type}: ${attr}=${template})`,
        );
      }
      continue;
    }
    if (attrs[attr] === undefined) attrs[attr] = r.value;
    else if (attrs[attr] !== r.value) {
      notes.push(
        `${attr}=${attrs[attr]} doesn't match @key ${type} (${attr}=${template} gives ${r.value})`,
      );
    }
  }
  return notes;
}

/** Separators a composite key is usually built with. */
const SEP = "#";

/**
 * Find a template that explains `values` (one key's value on each item) from
 * the same items' other attributes: split on `#`, and each segment is either
 * the same literal on every item or equal to one attribute on every item.
 * Null when no such template exists, or it would have no placeholder.
 */
export function inferTemplate(
  values: string[],
  items: Record<string, string>[],
  exclude: Set<string>,
): string | null {
  if (values.length < 2) return null;
  const parts = values.map((v) => v.split(SEP));
  const n = parts[0].length;
  if (parts.some((p) => p.length !== n)) return null;
  const out: string[] = [];
  let used = false;
  for (let i = 0; i < n; i++) {
    const segs = parts.map((p) => p[i]);
    const names = Object.keys(items[0])
      .filter((a) => !exclude.has(a) && a !== TYPE_ATTR)
      .filter((a) => items.every((it, k) => it[a] !== undefined && it[a] === segs[k]))
      .sort();
    // an attribute that varies is the better explanation than a constant
    const varies = new Set(segs).size > 1;
    if (names.length && (varies || segs[0].length > 0)) {
      if (!varies && /^[A-Z]+$/.test(segs[0])) {
        out.push(segs[0]); // an all-caps constant is a prefix like ORDER, keep it literal
        continue;
      }
      out.push(`{${names[0]}}`);
      used = true;
    } else if (!varies) {
      out.push(segs[0]);
    } else {
      return null;
    }
  }
  return used ? out.join(SEP) : null;
}

/** A suggested `@key` line, and items whose key breaks the pattern. */
export interface TemplateHint {
  type: string;
  template: KeyTemplate;
  /** Labels of items whose key doesn't follow the pattern the rest share. */
  deviants: { label: string; attr: string; expected: string }[];
}

/**
 * Look at the items of each entity type that has no template yet, and
 * suggest one for each key attribute whose values follow a pattern. With 3+
 * items, an item that alone breaks the pattern is reported as a deviant.
 */
export function suggestTemplates(
  items: { label: string; attrs: Record<string, string> }[],
  keyAttrs: string[],
  templates: KeyTemplates,
): TemplateHint[] {
  const byType = new Map<string, { label: string; attrs: Record<string, string> }[]>();
  for (const it of items) {
    const t = it.attrs[TYPE_ATTR];
    if (!t || templates.has(t)) continue;
    byType.set(t, [...(byType.get(t) ?? []), it]);
  }
  const hints: TemplateHint[] = [];
  const exclude = new Set(keyAttrs);
  for (const [type, list] of byType) {
    const template: KeyTemplate = {};
    const deviants: TemplateHint["deviants"] = [];
    for (const attr of keyAttrs) {
      const having = list.filter((it) => it.attrs[attr] !== undefined);
      if (having.length < 2) continue;
      const all = inferTemplate(
        having.map((it) => it.attrs[attr]),
        having.map((it) => it.attrs),
        exclude,
      );
      if (all) {
        template[attr] = all;
        continue;
      }
      if (having.length < 3) continue;
      // one item off the pattern the others share
      for (let skip = 0; skip < having.length; skip++) {
        const rest = having.filter((_, i) => i !== skip);
        const t = inferTemplate(
          rest.map((it) => it.attrs[attr]),
          rest.map((it) => it.attrs),
          exclude,
        );
        if (!t) continue;
        const odd = having[skip];
        const r = fill(t, odd.attrs);
        if ("value" in r) deviants.push({ label: odd.label, attr, expected: `${attr}=${r.value}` });
        template[attr] = t;
        break;
      }
    }
    if (Object.keys(template).length) hints.push({ type, template, deviants });
  }
  return hints;
}

/** Render a template as its `@key` line. */
export function keyLine(type: string, t: KeyTemplate): string {
  return [`@key ${type}`, ...Object.entries(t).map(([a, v]) => `${a}=${v}`)].join("  ");
}
