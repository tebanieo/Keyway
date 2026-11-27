import { fold, pkAttrs, skAttrs } from "../../engine/engine";
import { parseAttrs, parseDoc } from "../dsl";
import { TYPE_ATTR } from "../entities";
import { fill, inferTemplate, placeholders } from "../keyTemplates";
import { BASE_INDEX } from "../seed";
import {
  CITIES,
  COLORS,
  COMPANIES,
  COMPANY_TYPES,
  COUNTRIES,
  ENUMS,
  FIRST_NAMES,
  LAST_NAMES,
  LOREM,
  PERSON_TYPES,
  PRODUCT_TYPES,
  PRODUCTS,
  WORDS,
} from "./vocab";

/**
 * `@gen <type> <count> [per <parent>]  attr=a|b|c  attr=10..500`
 *
 * Expands, on request, into ordinary item lines: sample rows for an entity
 * type, shaped like the rows you already have (same attributes, the same few
 * values for status-like fields, keys following the same pattern) and, with
 * `per`, one batch for each parent item, sharing its partition key so the
 * item collections show. Deterministic: the same line in the same model
 * gives the same rows.
 */
export interface GenSpec {
  type: string;
  count: number;
  parent?: string;
  /** attr -> `a|b|c` (one of), `lo..hi` (a number in range), or a fixed value */
  hints: Record<string, string>;
}

export const GEN_LINE = /^\s*@gen\b/i;
const GEN = /^\s*@gen\s+([\w-]+)\s+(\d+)(?:\s+per\s+([\w-]+))?\s*(.*)$/i;
/** A sane cap: sample data, not a load test. */
export const GEN_MAX = 50;

export function parseGen(line: string): GenSpec | string {
  const m = GEN.exec(line);
  if (!m) {
    return "@gen needs a type and a count, e.g. `@gen project 3 per tenant  status=new|active|done`";
  }
  const count = Number(m[2]);
  if (count < 1 || count > GEN_MAX) return `@gen makes 1 to ${GEN_MAX} rows at a time`;
  return { type: m[1], count, parent: m[3], hints: parseAttrs(m[4] ?? "") };
}

// ---- seeded randomness -------------------------------------------------------

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

function rng(seed: number) {
  let a = seed;
  const next = () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (lo: number, hi: number) => lo + Math.floor(next() * (hi - lo + 1));
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(next() * xs.length)];
  return { next, int, pick };
}
type Rng = ReturnType<typeof rng>;

const slug = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

const pad = (n: number) => String(n).padStart(2, "0");

// ---- values ------------------------------------------------------------------

/** A value in the same shape as an example one (a date stays a date…). */
function likeValue(example: string, r: Rng): string | null {
  if (/^\d{4}-\d{2}-\d{2}T/.test(example)) {
    return `2024-${pad(r.int(1, 12))}-${pad(r.int(1, 28))}T${pad(r.int(8, 18))}:${pad(r.int(0, 59))}:00Z`;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(example)) return `2024-${pad(r.int(1, 12))}-${pad(r.int(1, 28))}`;
  if (/^\d{4}-\d{2}$/.test(example)) return `2024-${pad(r.int(1, 12))}`;
  if (/^-?\d+\.\d+$/.test(example)) {
    const v = Number(example);
    const places = example.split(".")[1].length;
    return (v * (0.3 + r.next() * 1.4) + 1).toFixed(places);
  }
  if (/^-?\d+$/.test(example)) {
    const v = Math.abs(Number(example));
    return String(Math.max(0, Math.round(v * (0.3 + r.next() * 1.4)) + r.int(0, 3)));
  }
  if (/^(true|false)$/.test(example)) return r.next() < 0.5 ? "true" : "false";
  return null;
}

interface Row {
  type: string;
  attrs: Record<string, string>;
  /** The values chosen for a person/company on this row, so email etc. agree. */
  first: string;
  last: string;
  company: string;
}

function byName(attr: string, row: Row, r: Rng, domain: string): string {
  const a = attr.toLowerCase().replace(/_/g, "");
  if (ENUMS[a]) return r.pick(ENUMS[a]);
  if (a === "name" || a === "fullname" || a === "displayname") {
    if (PERSON_TYPES.test(row.type)) return `${row.first} ${row.last}`;
    if (COMPANY_TYPES.test(row.type)) return row.company;
    if (PRODUCT_TYPES.test(row.type)) return r.pick(PRODUCTS);
    return r.pick(WORDS);
  }
  if (a === "first" || a === "firstname" || a === "givenname") return row.first;
  if (a === "last" || a === "lastname" || a === "surname" || a === "familyname") return row.last;
  if (a === "company" || a === "org" || a === "organization") return row.company;
  if (a.includes("email")) return `${slug(row.first)}.${slug(row.last)}@${domain}`;
  if (a === "username" || a === "handle" || a === "login")
    return `${slug(row.first)}${r.int(1, 99)}`;
  if (a.includes("phone") || a === "mobile") return `+1 555 01${pad(r.int(0, 99))}`;
  if (a === "city") return r.pick(CITIES);
  if (a === "country") return r.pick(COUNTRIES);
  if (a === "color" || a === "colour") return r.pick(COLORS);
  if (a === "url" || a === "website" || a === "homepage")
    return `https://${slug(row.company)}.example.com`;
  if (a === "sku") return `SKU-${r.int(1000, 9999)}`;
  if (a === "rating" || a === "stars") return String(r.int(1, 5));
  if (/date|day|deadline|due|birth|created|updated|at$|time/.test(a)) {
    return `2024-${pad(r.int(1, 12))}-${pad(r.int(1, 28))}`;
  }
  if (/price|total|amount|cost|balance|revenue|salary|fee|subtotal/.test(a)) {
    return (r.int(500, 50000) / 100).toFixed(2);
  }
  if (/count|qty|quantity|stock|age|score|votes|likes|followers|views|seats|points/.test(a)) {
    return String(r.int(1, 40));
  }
  if (/^(is|has|can)|enabled|verified|active$|archived$|deleted$/.test(a)) {
    return r.next() < 0.5 ? "true" : "false";
  }
  if (/title|description|body|text|note|comment|summary|subject|bio|message/.test(a)) {
    return `${r.pick(LOREM)} ${r.pick(LOREM)} ${r.pick(LOREM)}`;
  }
  if (/id$/.test(a)) return String(r.int(100, 999));
  return r.pick(WORDS).toLowerCase();
}

/** One attribute's value: your hint, then the type's own values, then a guess. */
function valueFor(
  attr: string,
  row: Row,
  hint: string | undefined,
  existing: string[],
  r: Rng,
  domain: string,
): string {
  if (hint !== undefined) {
    if (hint.includes("|"))
      return r.pick(
        hint
          .split("|")
          .map((s) => s.trim())
          .filter(Boolean),
      );
    const range = /^(-?\d+(?:\.\d+)?)\.\.(-?\d+(?:\.\d+)?)$/.exec(hint);
    if (range) {
      const [lo, hi] = [Number(range[1]), Number(range[2])];
      const places = (range[1].split(".")[1] ?? range[2].split(".")[1] ?? "").length;
      return places ? (lo + r.next() * (hi - lo)).toFixed(places) : String(r.int(lo, hi));
    }
    return hint;
  }
  const distinct = [...new Set(existing)];
  const key = attr.toLowerCase().replace(/_/g, "");
  // a status-like field keeps to a few values: the ones you use, else a set
  const enumLike =
    ENUMS[key] ||
    (distinct.length >= 2 &&
      distinct.length <= 4 &&
      existing.length > distinct.length &&
      distinct.every((v) => /^[A-Za-z_-]{1,16}$/.test(v)));
  if (enumLike) {
    const pool =
      distinct.length >= 2 ? distinct : [...new Set([...distinct, ...(ENUMS[key] ?? [])])];
    return r.pick(pool);
  }
  const shaped = existing.length ? likeValue(existing[existing.length - 1], r) : null;
  return shaped ?? byName(attr, row, r, domain);
}

// ---- keys ----------------------------------------------------------------------

/** How one `#`-separated segment of a key is made. */
type Seg =
  | { tpl: string } // a whole-key template from several rows ({attr} parts)
  | { lit: string } // fixed: ORDER, META
  | { attr: string } // an attribute's value: STATUS#{status}
  | { slugOf: string } // an attribute's value, slugged: USER#ada from name=Ada
  | { link: [string, number] } // the same segment of an earlier key
  | { shape: string } // a new value like this one (a date, a number)
  | { seq: number } // the next number after the type's highest
  | { made: true } // the row's name, slugged (or a short number)
  | { value: true }; // a plain attribute that's also a key: generated like any value

/** The first key in the order is the table's partition key. */
const earlierBase = (earlier: string[], key: string) => (earlier.length === 0 ? key : earlier[0]);

function planKey(
  value: string,
  key: string,
  proto: Record<string, string>,
  earlier: string[],
  exclude: Set<string>,
  same: { attrs: Record<string, string> }[],
): Seg[] {
  const segs = value.split("#");
  // A plain value that's a GSI key (multi-key indexes use tenant, region …):
  // made like any attribute, from the values it already takes.
  const isBase = key === earlierBase(earlier, key);
  if (segs.length === 1 && !isBase && !/^[A-Z][A-Z0-9_]*$/.test(value)) {
    const linked = earlier.find((o) => proto[o] === value);
    if (!linked) return [{ value: true }];
  }
  return segs.map((seg, i): Seg => {
    const plain = Object.keys(proto).filter((a) => !exclude.has(a) && a !== TYPE_ATTR);
    const attr = plain.find((a) => proto[a] === seg && seg !== "");
    if (attr && !/^[A-Z]+$/.test(seg)) return { attr };
    for (const o of earlier) {
      const j = proto[o]?.split("#").indexOf(seg) ?? -1;
      if (j >= 0 && seg !== "" && !/^[A-Z_]+$/.test(seg)) return { link: [o, j] };
    }
    if (/^[A-Z][A-Z0-9_]*$/.test(seg) || seg === "") return { lit: seg };
    const slugged = plain.find((a) => slug(proto[a]) === seg && seg !== "");
    if (slugged) return { slugOf: slugged };
    if (/^\d+$/.test(seg) && segs.length > 1) {
      // ORDER#1, ORDER#2 … → the next ones
      const max = Math.max(0, ...same.map((it) => Number(it.attrs[key]?.split("#")[i]) || 0));
      return { seq: max };
    }
    if (likeValue(seg, rng(1)) !== null) return { shape: seg };
    return i === segs.length - 1 ? { made: true } : { lit: seg };
  });
}

function buildKey(
  plan: Seg[],
  row: Row,
  keys: Record<string, string>,
  r: Rng,
  rowIdx: number,
  plainValue: () => string,
): { value: string; made: boolean } | null {
  let made = false;
  const parts: string[] = [];
  for (const s of plan) {
    if ("value" in s) {
      parts.push(plainValue());
      continue;
    }
    if ("tpl" in s) {
      const f = fill(s.tpl, row.attrs);
      if ("missing" in f) return null;
      parts.push(f.value);
    } else if ("lit" in s) parts.push(s.lit);
    else if ("attr" in s) {
      if (row.attrs[s.attr] === undefined) return null;
      parts.push(row.attrs[s.attr]);
    } else if ("slugOf" in s) {
      parts.push(slug(row.attrs[s.slugOf] ?? "") || String(r.int(100, 999)));
      made = true;
    } else if ("link" in s) {
      const src = keys[s.link[0]]?.split("#")[s.link[1]];
      if (src === undefined) return null;
      parts.push(src);
    } else if ("shape" in s) {
      parts.push(likeValue(s.shape, r) ?? s.shape);
      made = true;
    } else if ("seq" in s) {
      parts.push(String(s.seq + rowIdx + 1));
      made = true;
    } else {
      const name = row.attrs.name ?? row.attrs.title;
      parts.push((name && slug(name)) || String(r.int(100, 999)));
      made = true;
    }
  }
  return { value: parts.join("#"), made };
}

// ---- expand ----------------------------------------------------------------------

/**
 * Turn the `@gen` line at 0-based `lineIdx` of `doc` into item lines, read
 * against the rest of the model. An error says what's missing (e.g. no
 * parents to attach to yet).
 */
export function expandGen(doc: string, lineIdx: number): { lines: string[] } | { error: string } {
  const lines = doc.split("\n");
  const spec = parseGen(lines[lineIdx] ?? "");
  if (typeof spec === "string") return { error: spec };
  const rest = lines.filter((_, i) => i !== lineIdx).join("\n");
  const parsed = parseDoc(rest, BASE_INDEX);
  const { base, gsis } = parsed;
  const items = [...fold(parsed.ops, base).values()];
  const typed = (t: string) => items.filter((it) => it.attrs[TYPE_ATTR] === t);
  const same = typed(spec.type);
  const parents = spec.parent ? typed(spec.parent) : [null];
  if (spec.parent && parents.length === 0) {
    return {
      error: `no ${spec.parent} items to add ${spec.type} rows to yet: start with \`@gen ${spec.parent} 3\``,
    };
  }

  const basePk = pkAttrs(base)[0];
  const baseSk = skAttrs(base)[0];
  const keyAttrs = [...new Set([base, ...gsis].flatMap((ix) => [...pkAttrs(ix), ...skAttrs(ix)]))];
  const isKey = new Set(keyAttrs);
  const template = parsed.keys.get(spec.type) ?? {};
  const proto = same.at(-1)?.attrs ?? {};

  // The attributes a row carries: the type's own (in the order the last one
  // has them), anything a hint or the @key template needs.
  const attrNames: string[] = [];
  const add = (a: string) => {
    if (!isKey.has(a) && a !== TYPE_ATTR && !attrNames.includes(a)) attrNames.push(a);
  };
  for (const it of same) Object.keys(it.attrs).forEach(add);
  Object.values(template).flatMap(placeholders).forEach(add);
  Object.keys(spec.hints).forEach(add);
  if (attrNames.length === 0) {
    const t = spec.type;
    const defaults = PERSON_TYPES.test(t)
      ? ["name", "email"]
      : COMPANY_TYPES.test(t)
        ? ["name", "plan"]
        : PRODUCT_TYPES.test(t)
          ? ["name", "price"]
          : ["name", "status", "created"];
    defaults.forEach(add);
  }

  // How each key is made, learned segment by segment from the type's rows
  // (unless @key says): keys in order, base table first, so a segment can
  // copy one from an earlier key.
  const exclude = new Set(keyAttrs);
  const order = [basePk, baseSk, ...keyAttrs].filter(
    (k, i, a): k is string => !!k && a.indexOf(k) === i,
  );
  const plans = new Map<string, Seg[]>();
  for (const k of order) {
    if (template[k] || proto[k] === undefined) continue;
    const having = same.filter((it) => it.attrs[k] !== undefined);
    const exact =
      having.length >= 2
        ? inferTemplate(
            having.map((it) => it.attrs[k]),
            having.map((it) => it.attrs),
            exclude,
          )
        : null;
    plans.set(
      k,
      exact
        ? [{ tpl: exact }]
        : planKey(proto[k], k, proto, order.slice(0, order.indexOf(k)), exclude, same),
    );
  }

  // Labels: keep the type's own prefix (p1, p2 → p3…), never reusing one the
  // script has used (a deleted o2 stays o2's).
  const allLabels = new Set<string>(
    parsed.ops.flatMap((op) =>
      op.kind === "transact"
        ? op.actions.map((a) => (a.kind === "put" ? a.item.id : a.id))
        : [op.kind === "put" ? op.item.id : op.id],
    ),
  );
  const prefix =
    (same.length && /^([A-Za-z_]+)\d+$/.exec(same[0].id)?.[1]) ||
    spec.type
      .replace(/[^A-Za-z]/g, "")
      .slice(0, 1)
      .toLowerCase() ||
    "x";
  let n = 1;
  const nextLabel = () => {
    while (allLabels.has(`${prefix}${n}`)) n++;
    allLabels.add(`${prefix}${n}`);
    return `${prefix}${n}`;
  };

  const usedKeys = new Set(
    items.map((it) => `${it.attrs[basePk] ?? ""}\u0000${baseSk ? (it.attrs[baseSk] ?? "") : ""}`),
  );
  // Seeded by the line and the model's items (not comments or spacing), so the
  // same request on the same data gives the same rows.
  const r = rng(hash(`${lines[lineIdx].trim()}\u0000${items.map((it) => it.id).join(",")}`));
  const usedNames = new Set(same.map((it) => it.attrs.name).filter(Boolean));
  // slugs already in keys (TENANT#acme → acme), so a new "Acme" isn't a clash
  const usedSlugs = new Set(
    items.flatMap((it) => keyAttrs.map((k) => it.attrs[k]?.split("#").pop() ?? "")),
  );
  const emailDomain =
    same
      .map(
        (it) => Object.entries(it.attrs).find(([k, v]) => /email/i.test(k) && v.includes("@"))?.[1],
      )
      .find(Boolean)
      ?.split("@")[1] ?? "example.com";

  const out: string[] = [];
  for (const parent of parents) {
    for (let i = 0; i < spec.count; i++) {
      const row: Row = {
        type: spec.type,
        attrs: {},
        first: r.pick(FIRST_NAMES),
        last: r.pick(LAST_NAMES),
        company: r.pick(COMPANIES),
      };
      // the domain the type's emails already use; else one from the parent company
      const domain =
        emailDomain === "example.com" && COMPANY_TYPES.test(spec.parent ?? "") && parent?.attrs.name
          ? `${slug(parent.attrs.name)}.com`
          : emailDomain;
      for (const a of attrNames) {
        const existing = same.map((it) => it.attrs[a]).filter((v): v is string => v !== undefined);
        let v = valueFor(a, row, spec.hints[a], existing, r, domain);
        // names should differ within the batch
        if (a === "name") {
          for (let tries = 0; (usedNames.has(v) || usedSlugs.has(slug(v))) && tries < 20; tries++) {
            v = valueFor(
              a,
              { ...row, first: r.pick(FIRST_NAMES), company: r.pick(COMPANIES) },
              undefined,
              existing,
              r,
              domain,
            );
          }
          usedNames.add(v);
          usedSlugs.add(slug(v));
        }
        row.attrs[a] = v;
      }

      // Keys: the parent's partition, else the learned plan.
      const keys: Record<string, string> = {};
      let named: string | undefined; // a base key with a made-up part, to vary on a clash
      const rowIdx = out.length;
      for (const k of order) {
        if (template[k]) continue; // @key fills it in
        if (parent && k === basePk && parent.attrs[k] !== undefined) {
          keys[k] = parent.attrs[k];
          continue;
        }
        const plan = plans.get(k);
        if (!plan) continue;
        const built = buildKey(plan, row, keys, r, rowIdx, () =>
          valueFor(
            k,
            row,
            spec.hints[k],
            same.map((it) => it.attrs[k]).filter((v): v is string => v !== undefined),
            r,
            emailDomain,
          ),
        );
        if (built === null) continue;
        keys[k] = built.value;
        if (built.made && (k === basePk || k === baseSk)) named ??= k;
      }
      // A row needs its own base key. The full key includes what a @key
      // template will make, so a clash is seen even when the SK is templated.
      const fullKey = () =>
        [basePk, baseSk]
          .map((k) => {
            if (!k) return "";
            if (template[k]) {
              const f = fill(template[k], row.attrs);
              return "value" in f ? f.value : "";
            }
            return keys[k] ?? "";
          })
          .join("\u0000");
      const fromParent = (k: string) => !!parent && k === basePk;
      let guard = 0;
      while (usedKeys.has(fullKey()) && guard++ < 50) {
        const templated = [baseSk, basePk].find((k) => k && template[k]);
        if (templated) {
          // re-roll the attributes the template reads (a new date, a new id)
          for (const a of placeholders(template[templated])) {
            const existing = same.map((it) => it.attrs[a]).filter((v): v is string => !!v);
            row.attrs[a] = valueFor(a, row, spec.hints[a], existing, r, emailDomain);
          }
          if (guard < 20) continue;
        }
        // else change the part made from the name; never a fixed one like
        // SK=META, and never the parent's partition key
        const k =
          named ?? [baseSk, basePk].find((x) => x && keys[x] !== undefined && !fromParent(x));
        if (!k) break;
        keys[k] = `${keys[k]}-${r.int(2, 99)}`;
      }
      usedKeys.add(fullKey());

      const lead = [basePk, baseSk].filter((k): k is string => !!k && keys[k] !== undefined);
      const gsiKeys = keyAttrs.filter((k) => !lead.includes(k) && keys[k] !== undefined);
      const pairs = [
        ...lead.map((k) => `${k}=${keys[k]}`),
        ...attrNames.map((a) => `${a}=${row.attrs[a]}`),
        ...gsiKeys.map((k) => `${k}=${keys[k]}`),
        `${TYPE_ATTR}=${spec.type}`,
      ];
      out.push(`${nextLabel()}: ${pairs.join("  ")}`);
    }
  }
  return { lines: out };
}
