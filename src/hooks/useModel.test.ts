// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useModel } from "./useModel";
import type { Op } from "../engine/types";

const MODEL = `@table AppTable pk=PK sk=SK
@gsi GSI1 pk=GSI1PK sk=GSI1SK projection=all

u1: PK=USER#1  SK=PROFILE  GSI1PK=EMAIL#a  GSI1SK=USER#1
o1: PK=USER#1  SK=ORDER#1  status=pending`;

describe("useModel", () => {
  it("starts empty and not dirty", () => {
    const { result } = renderHook(() => useModel());
    expect(result.current.ops).toEqual([]);
    expect(result.current.curStep).toBe(0);
    expect(result.current.gsis).toEqual([]);
    expect(result.current.dirty).toBe(false);
    expect(result.current.cost).toBeNull();
    expect(result.current.backfill).toBeNull();
    expect(result.current.state.size).toBe(0);
    expect(result.current.paneNames).toHaveLength(1); // just the base pane
  });

  it("onDoc parses text into ops, structure, and panes, showing the whole script", () => {
    const { result } = renderHook(() => useModel());
    act(() => result.current.onDoc(MODEL));

    expect(result.current.ops).toHaveLength(2);
    expect(result.current.base.name).toBe("AppTable");
    expect(result.current.gsis).toHaveLength(1);
    expect(result.current.paneNames).toEqual(["AppTable", "GSI1"]);
    expect(result.current.curStep).toBe(2); // typing shows every step
    expect(result.current.state.size).toBe(2);
    expect(result.current.dirty).toBe(true);
  });

  it("load jumps to the end and bumps docVersion so the editor remounts", () => {
    const { result } = renderHook(() => useModel());
    expect(result.current.docVersion).toBe(0);

    act(() => result.current.load(MODEL));
    expect(result.current.docText).toBe(MODEL);
    expect(result.current.ops).toHaveLength(2);
    expect(result.current.curStep).toBe(2);
    expect(result.current.docVersion).toBe(1);

    act(() => result.current.load(MODEL));
    expect(result.current.docVersion).toBe(2);
  });

  it("reset clears the model and bumps docVersion", () => {
    const { result } = renderHook(() => useModel());
    act(() => result.current.load(MODEL));
    const versionAfterLoad = result.current.docVersion;

    act(() => result.current.reset());
    expect(result.current.ops).toEqual([]);
    expect(result.current.curStep).toBe(0);
    expect(result.current.gsis).toEqual([]);
    expect(result.current.dirty).toBe(false);
    expect(result.current.docVersion).toBe(versionAfterLoad + 1);
  });

  it("clamps the scrubber to the op count and drives cost/backfill by position", () => {
    const { result } = renderHook(() => useModel());
    act(() => result.current.load(MODEL));

    // past the end clamps to ops.length
    act(() => result.current.setStep(99));
    expect(result.current.curStep).toBe(2);

    // mid-scrub: cost reflects the current step, state shrinks
    act(() => result.current.setStep(1));
    expect(result.current.curStep).toBe(1);
    expect(result.current.state.size).toBe(1);
    expect(result.current.cost).not.toBeNull();

    // at step 0 there is no current write
    act(() => result.current.setStep(0));
    expect(result.current.cost).toBeNull();
  });

  it("commit appends at the scrubber head and truncates the future (branching)", () => {
    const { result } = renderHook(() => useModel());
    act(() => result.current.load(MODEL));

    // rewind to step 1, then commit — op #2 (the future) is dropped
    act(() => result.current.setStep(1));
    const put: Op = { kind: "put", item: { id: "x1", attrs: { PK: "USER#9", SK: "PROFILE" } } };
    act(() => result.current.commit([put]));

    expect(result.current.ops).toHaveLength(2);
    expect(result.current.ops[1]).toEqual(put);
    expect(result.current.curStep).toBe(2);
  });

  it("commit ignores an empty op list", () => {
    const { result } = renderHook(() => useModel());
    act(() => result.current.load(MODEL));
    act(() => result.current.commit([]));
    expect(result.current.ops).toHaveLength(2);
    expect(result.current.curStep).toBe(2);
  });

  it("addItem appends a blank base row, returns its label, and reflects it in the doc", () => {
    const { result } = renderHook(() => useModel());
    act(() => result.current.load(MODEL));

    let label = "";
    act(() => {
      label = result.current.addItem("USER#9");
    });
    expect(label).toBeTruthy();
    expect(result.current.ops).toHaveLength(3);
    expect(result.current.docText).toContain("USER#9");
  });

  it("serialize round-trips the structure back to DSL text", () => {
    const { result } = renderHook(() => useModel());
    act(() => result.current.load(MODEL));
    const text = result.current.serialize(result.current.ops);
    expect(text).toContain("@gsi GSI1");
    expect(text).toContain("AppTable");
  });

  it("syncDoc reflects the current ops as editor text", () => {
    const { result } = renderHook(() => useModel());
    act(() => result.current.load(MODEL));
    act(() => result.current.syncDoc());
    expect(result.current.docText).toContain("@gsi GSI1");
  });

  it("counts unserved access patterns for the rail badge", () => {
    const withUnserved = `${MODEL}
@ap A dangling pattern with no index`;
    const { result } = renderHook(() => useModel());
    act(() => result.current.load(withUnserved));
    expect(result.current.aps).toHaveLength(1);
    expect(result.current.apUnserved).toBe(1);
  });

  it("suggests a backfill for entity schema drift, only at the log head", () => {
    const drift = `@table T pk=PK sk=SK
o1: PK=O#1  SK=ORDER  _type=order  total=1  discount=5
o2: PK=O#2  SK=ORDER  _type=order  total=2`;
    const { result } = renderHook(() => useModel());
    act(() => result.current.load(drift));

    // at the head: discount is on o1 but not o2
    expect(result.current.backfill?.attr).toBe("discount");
    expect(result.current.backfill?.targets).toHaveLength(1);

    // scrub off the head: no suggestion mid-playback
    act(() => result.current.setStep(1));
    expect(result.current.backfill).toBeNull();
  });
});
