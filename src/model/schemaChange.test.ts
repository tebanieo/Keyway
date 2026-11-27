import { describe, it, expect } from "vitest";
import { schemaChanges } from "./schemaChange";
import type { IndexSpec } from "../engine/types";

const base: IndexSpec = { name: "T", pk: "PK", sk: "SK" };
const g1: IndexSpec = { name: "GSI1", pk: "GSI1PK", sk: "GSI1SK" };

describe("schemaChanges", () => {
  it("is empty when nothing about the keys changed", () => {
    expect(schemaChanges({ base, gsis: [g1] }, { base, gsis: [g1] })).toEqual([]);
    // a projection change isn't a key change
    const proj = { ...g1, projection: "KEYS_ONLY" as const };
    expect(schemaChanges({ base, gsis: [g1] }, { base, gsis: [proj] })).toEqual([]);
  });

  it("explains a table key change as a new table plus a copy", () => {
    const [c] = schemaChanges({ base, gsis: [] }, { base: { ...base, sk: "SK2" }, gsis: [] });
    expect(c.kind).toBe("table-keys");
    expect(c.message).toMatch(/new table/);
    expect(c.message).toContain("pk=PK sk=SK2");
  });

  it("explains a GSI key change as delete and re-create, and a new GSI as a backfill", () => {
    const changed = { ...g1, sk: "date" };
    const g2: IndexSpec = { name: "GSI2", pk: "status" };
    const out = schemaChanges({ base, gsis: [g1] }, { base, gsis: [changed, g2] });
    expect(out.map((c) => c.kind)).toEqual(["gsi-keys", "gsi-added"]);
    expect(out[0].message).toMatch(/deleting the index and creating it again/);
    expect(out[1].message).toMatch(/backfill/);
  });
});
