import { describe, expect, it } from "vitest";
import { EXAMPLES } from "./examples";
import { parseDoc } from "./dsl";
import { fold } from "../engine/engine";
import type { IndexSpec } from "../engine/types";

const BASE: IndexSpec = { name: "base", pk: "PK", sk: "SK" };

describe("examples", () => {
  it("every example parses with no errors and yields a non-empty model", () => {
    for (const ex of EXAMPLES) {
      const { ops, diagnostics, base } = parseDoc(ex.dsl, BASE);
      const errors = diagnostics.filter((d) => d.severity === "error");
      expect(errors, `${ex.name} should have no parse errors`).toEqual([]);
      expect(fold(ops, base).size, `${ex.name} should have items`).toBeGreaterThan(0);
    }
  });

  it("every example has a name and description", () => {
    for (const ex of EXAMPLES) {
      expect(ex.name.length).toBeGreaterThan(0);
      expect(ex.description.length).toBeGreaterThan(0);
    }
  });
});
