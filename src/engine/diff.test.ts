import { describe, expect, it } from "vitest";
import { fold, project } from "./engine";
import { diffPartitions } from "./diff";
import type { IndexSpec, Op } from "./types";

const BASE: IndexSpec = { name: "base", pk: "PK", sk: "SK" };
const GSI1: IndexSpec = { name: "GSI1", pk: "GSI1PK", sk: "GSI1SK" };

function put(id: string, attrs: Record<string, string>): Op {
  return { kind: "put", item: { id, attrs } };
}

/** Convenience: (statusOf id) across all partitions. */
function statusMap(parts: ReturnType<typeof diffPartitions>) {
  const m: Record<string, string[]> = {};
  for (const p of parts) {
    for (const r of p.rows) {
      (m[r.item.id] ??= []).push(`${p.pk}:${r.status}`);
    }
  }
  return m;
}

const view = (ops: Op[], index: IndexSpec) => project(fold(ops, BASE), index);

describe("diffPartitions", () => {
  it("added vs same on an insert", () => {
    const before = [put("a", { PK: "U#1", SK: "B" })];
    const after = [...before, put("b", { PK: "U#1", SK: "C" })];
    const m = statusMap(diffPartitions(view(before, BASE), view(after, BASE), BASE));
    expect(m.a).toEqual(["U#1:same"]);
    expect(m.b).toEqual(["U#1:added"]);
  });

  it("a deletion leaves a tombstone in its partition", () => {
    const before = [
      put("a", { PK: "U#1", SK: "B" }),
      put("b", { PK: "U#1", SK: "C" }),
    ];
    const after = [put("a", { PK: "U#1", SK: "B" })];
    const m = statusMap(diffPartitions(view(before, BASE), view(after, BASE), BASE));
    expect(m.a).toEqual(["U#1:same"]);
    expect(m.b).toEqual(["U#1:removed"]);
  });

  it("a GSI key change is removed-from-old + added-to-new (the reindex)", () => {
    const before = [
      put("o1", { PK: "U#1", SK: "O#1", GSI1PK: "STATUS#pending", GSI1SK: "d" }),
    ];
    const after = [
      put("o1", { PK: "U#1", SK: "O#1", GSI1PK: "STATUS#shipped", GSI1SK: "d" }),
    ];
    const m = statusMap(diffPartitions(view(before, GSI1), view(after, GSI1), GSI1));
    expect(m.o1.sort()).toEqual(
      ["STATUS#pending:removed", "STATUS#shipped:added"].sort(),
    );
  });

  it("the same key change is only a modify on the base table", () => {
    const before = [
      put("o1", { PK: "U#1", SK: "O#1", GSI1PK: "STATUS#pending", GSI1SK: "d" }),
    ];
    const after = [
      put("o1", { PK: "U#1", SK: "O#1", GSI1PK: "STATUS#shipped", GSI1SK: "d" }),
    ];
    const m = statusMap(diffPartitions(view(before, BASE), view(after, BASE), BASE));
    expect(m.o1).toEqual(["U#1:modified"]);
  });
});
