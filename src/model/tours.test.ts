import { describe, expect, it } from "vitest";
import { TOURS } from "./tours";
import { parseDoc } from "./dsl";
import { conditionRejected, fold } from "../engine/engine";
import type { IndexSpec } from "../engine/types";

const BASE: IndexSpec = { name: "base", pk: "PK", sk: "SK" };

describe("tours", () => {
  it.each(TOURS.map((t) => [t.name, t.dsl]))(
    "%s parses with no errors and yields a model",
    (_, dsl) => {
      const { ops, diagnostics, base } = parseDoc(dsl, BASE);
      expect(diagnostics.filter((d) => d.severity === "error")).toEqual([]);
      expect(fold(ops, base).size).toBeGreaterThan(0);
    },
  );

  it("Conditional Writes rejects exactly the impostor insert and the late cancel", () => {
    const tour = TOURS.find((t) => t.name === "Conditional Writes")!;
    const { ops, base } = parseDoc(tour.dsl, BASE);
    const rejected = ops.map((op, i) => conditionRejected(fold(ops.slice(0, i), base), op, base));
    expect(rejected).toEqual([false, true, false, false, true]);
    const items = [...fold(ops, base).values()].map((it) => it.attrs);
    expect(items).toContainEqual(expect.objectContaining({ name: "Ada Lovelace" }));
    expect(items).toContainEqual(expect.objectContaining({ SK: "ORDER#1", status: "shipped" }));
  });
});
