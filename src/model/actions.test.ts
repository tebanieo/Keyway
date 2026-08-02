import { describe, expect, it } from "vitest";
import { describe as describeOp, editToOps, keyLabel, nextItemLabel } from "./actions";
import type { IndexSpec, Op } from "../engine/types";

const BASE: IndexSpec = { name: "base", pk: "PK", sk: "SK" };
const put = (id: string, attrs: Record<string, string>): Op => ({
  kind: "put",
  item: { id, attrs },
});

describe("nextItemLabel", () => {
  it("returns the first free i-label over the op log", () => {
    expect(nextItemLabel([])).toBe("i1");
    expect(nextItemLabel([put("i1", {}), put("i2", {})])).toBe("i3");
    expect(nextItemLabel([put("i1", {}), { kind: "delete", id: "i3" }])).toBe("i2");
  });
});

describe("editToOps", () => {
  it("a non-key change is a single put", () => {
    const ops = editToOps({ id: "o", attrs: { PK: "A", SK: "B", x: "1" } }, "x", "2", BASE);
    expect(ops).toEqual([{ kind: "put", item: { id: "o", attrs: { PK: "A", SK: "B", x: "2" } } }]);
  });
  it("a base-key change is an atomic transact (delete + put)", () => {
    const ops = editToOps({ id: "o", attrs: { PK: "A", SK: "B" } }, "PK", "C", BASE);
    expect(ops[0].kind).toBe("transact");
  });
});

describe("keyLabel / describe", () => {
  it("keyLabel is `PK / SK` (or PK only for a PK-only table)", () => {
    expect(keyLabel({ PK: "A", SK: "B" }, BASE)).toBe("A / B");
    expect(keyLabel({ PK: "A" }, { name: "b", pk: "PK" })).toBe("A");
  });
  it("describe summarizes each op kind", () => {
    expect(describeOp(undefined, BASE).verb).toBe("start");
    expect(describeOp({ kind: "delete", id: "o1" }, BASE)).toEqual({
      verb: "delete",
      detail: "o1",
    });
    expect(describeOp(put("o", { PK: "A", SK: "B" }), BASE)).toEqual({
      verb: "put",
      detail: "A / B",
    });
    const tx: Op = {
      kind: "transact",
      actions: [
        { kind: "delete", id: "o" },
        { kind: "put", item: { id: "o", attrs: { PK: "C", SK: "D" } } },
      ],
    };
    expect(describeOp(tx, BASE).verb).toBe("transact");
  });
});
