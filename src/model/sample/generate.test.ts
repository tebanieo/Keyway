import { describe, expect, it } from "vitest";
import { expandGen, parseGen } from "./generate";
import { EXAMPLES } from "../examples";
import { parseDoc } from "../dsl";
import { BASE_INDEX } from "../seed";
import { fold } from "../../engine/engine";

const saas = EXAMPLES.find((e) => e.name.startsWith("Multi-tenant"))!.dsl;

/** Expand the first @gen line of `doc` and return the new doc and its rows. */
function gen(doc: string) {
  const lines = doc.split("\n");
  const at = lines.findIndex((l) => l.trim().startsWith("@gen"));
  const r = expandGen(doc, at);
  if ("error" in r) throw new Error(r.error);
  lines.splice(at, 1, ...r.lines);
  const next = lines.join("\n");
  const p = parseDoc(next, BASE_INDEX);
  const items = [...fold(p.ops, p.base).values()];
  return { rows: r.lines, items, diagnostics: p.diagnostics, next };
}
const ofType = (items: { attrs: Record<string, string> }[], t: string) =>
  items.filter((i) => i.attrs._type === t);

describe("@gen sample rows", () => {
  it("reads the line: type, count, per parent, and hints", () => {
    expect(parseGen("@gen project 3 per tenant  status=new|done  total=1..9")).toEqual({
      type: "project",
      count: 3,
      parent: "tenant",
      hints: { status: "new|done", total: "1..9" },
    });
    expect(parseGen("@gen project")).toMatch(/needs a type and a count/);
    expect(parseGen("@gen project 500")).toMatch(/1 to 50/);
  });

  it("adds rows for each parent, in the parent's partition, shaped like the type's rows", () => {
    const withTenants = gen(`${saas}\n@gen tenant 2\n`).next;
    const { items, diagnostics } = gen(`${withTenants}\n@gen project 2 per tenant\n`);
    const tenants = ofType(items, "tenant");
    expect(tenants).toHaveLength(3);
    for (const t of tenants) {
      const mine = ofType(items, "project").filter((p) => p.attrs.PK === t.attrs.PK);
      expect(mine.length).toBeGreaterThanOrEqual(2); // acme already had 2
    }
    const p = ofType(items, "project").at(-1)!.attrs;
    // keys follow the existing pattern (STATUS#<status>), dates keep their format
    expect(p.GSI1PK).toBe(`STATUS#${p.status}`);
    expect(p.GSI1SK).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(p.SK).toMatch(/^PROJECT#/);
    expect(diagnostics.filter((d) => d.severity === "error")).toEqual([]);
  });

  it("keeps a status-like field to a few values: your hint, or the ones you use", () => {
    const { items } = gen(
      `${saas}\n@gen project 6 per tenant  status=new|active|pending|complete\n`,
    );
    const fresh = ofType(items, "project").slice(2);
    for (const p of fresh)
      expect(["new", "active", "pending", "complete"]).toContain(p.attrs.status);
    const plain = ofType(gen(`${saas}\n@gen project 6 per tenant\n`).items, "project").slice(2);
    for (const p of plain) expect(["active", "archived"]).toContain(p.attrs.status);
  });

  it("matches emails to the people and to the GSI key built from them", () => {
    const { items } = gen(`${saas}\n@gen user 2 per tenant\n`);
    const u = ofType(items, "user").at(-1)!.attrs;
    expect(u.email).toMatch(/@acme\.com$/); // the domain the tenant's users use
    expect(u.GSI1PK).toBe(`EMAIL#${u.email}`);
    expect(u.GSI1SK).toBe(u.PK); // it mirrors the partition key, as the others do
  });

  it("lets a @key template make the keys, and honours number ranges", () => {
    const { rows, items } = gen(`@table T pk=PK sk=SK
@key order  PK=USER#{user_id}  SK=ORDER#{order_id}
@gen order 3  user_id=1..5  order_id=100..999  total=10.00..99.99
`);
    expect(rows[0]).not.toMatch(/\bPK=/); // left to the template
    const orders = ofType(items, "order");
    expect(orders).toHaveLength(3);
    for (const o of orders) {
      expect(o.attrs.SK).toBe(`ORDER#${o.attrs.order_id}`);
      expect(Number(o.attrs.total)).toBeGreaterThanOrEqual(10);
      expect(o.attrs.total).toMatch(/^\d+\.\d{2}$/);
    }
  });

  it("gives every row its own key, and the same line the same rows", () => {
    const doc = `${saas}\n@gen tenant 5\n`;
    const a = gen(doc);
    expect(new Set(ofType(a.items, "tenant").map((t) => t.attrs.PK)).size).toBe(6);
    expect(gen(doc).rows).toEqual(a.rows);
  });

  it("starts a brand-new type with sensible attributes", () => {
    const { rows } = gen("@table T pk=PK sk=SK\n@gen customer 2\n");
    expect(rows[0]).toMatch(/^c1: name=\S+ \S+ {2}email=\S+@example\.com {2}_type=customer$/);
  });

  it("says what's missing when there's no parent to attach to", () => {
    const doc = `${saas}\n@gen invoice 2 per order\n`;
    const r = expandGen(doc, doc.split("\n").length - 2);
    expect(r).toEqual({ error: expect.stringMatching(/no order items .*`@gen order 3`/) });
  });
});
