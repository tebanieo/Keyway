import { useCallback, useMemo, useState } from "react";
import { fold, project } from "../engine/engine";
import { writeCost } from "../engine/cost";
import type { OpCost } from "../engine/cost";
import type { IndexSpec, Op } from "../engine/types";
import { parseDoc, serializeModel } from "../model/dsl";
import type { AccessPattern } from "../model/dsl";
import { nextItemLabel } from "../model/actions";
import { apCoverage } from "../model/coverage";
import { computeBackfill } from "../model/backfill";
import { BASE_INDEX } from "../model/seed";
import { EMPTY_DOC } from "../model/doc";

/**
 * The whole data model in one hook: the op log and the DSL structure it parses
 * into (base table, GSIs, access patterns, narration), the step scrubber, and
 * every projection derived from them (the folded state, per-index views, write
 * cost, backfill suggestion, coverage). App owns the UI around this — modes,
 * drawers, playback, pins — and drives the model through the producers here.
 *
 * The producers stay PURE to the model: `load`/`reset`/`addItem` don't touch
 * modes or pins, so App composes those side effects in its own wrappers. This
 * is the slice that had no UI tests, so the contract is: identical behavior to
 * the inlined version, just relocated.
 */
export function useModel() {
  const [ops, setOps] = useState<Op[]>([]);
  const [docText, setDocText] = useState(EMPTY_DOC);
  // Bumped only when the doc is REPLACED externally (load/reset), used as the
  // editor's React key so it remounts with the new text. Typing must not bump it.
  const [docVersion, setDocVersion] = useState(0);
  const [step, setStep] = useState(0);
  const [notes, setNotes] = useState<(string | undefined)[]>(
    () => parseDoc(EMPTY_DOC, BASE_INDEX).notes,
  );
  // 0-based source line for each op, aligned with `ops`; drives the editor's
  // step highlight (which line the current step is running).
  const [opLines, setOpLines] = useState<number[]>(() => parseDoc(EMPTY_DOC, BASE_INDEX).opLines);
  const [aps, setAps] = useState<AccessPattern[]>(() => parseDoc(EMPTY_DOC, BASE_INDEX).aps);
  // Base table + secondary indexes, declared in the DSL (`@table` / `@gsi`).
  const [base, setBase] = useState<IndexSpec>(() => parseDoc(EMPTY_DOC, BASE_INDEX).base);
  const [gsis, setGsis] = useState<IndexSpec[]>(() => parseDoc(EMPTY_DOC, BASE_INDEX).gsis);

  const curStep = Math.min(step, ops.length);

  // ---- op-log producers -----------------------------------------------------
  // canvas: grid actions append ops. editor: typed text parses to ops. Both
  // funnel into the same `ops`, so the panes never know which produced them.
  const commit = useCallback(
    (added: Op[]) => {
      if (added.length === 0) return;
      setOps((prev) => [...prev.slice(0, curStep), ...added]);
      setStep(curStep + added.length);
    },
    [curStep],
  );

  const onDoc = useCallback((text: string) => {
    setDocText(text);
    const parsed = parseDoc(text, BASE_INDEX);
    setOps(parsed.ops);
    setStep(parsed.ops.length); // typing shows the whole script
    setBase(parsed.base);
    setGsis(parsed.gsis);
    setNotes(parsed.notes);
    setOpLines(parsed.opLines);
    setAps(parsed.aps);
  }, []);

  // Load a whole model from text (a shared link, or an example). Pure to the
  // model: the caller opens the editor / clears the pin around this.
  const load = useCallback((text: string) => {
    const parsed = parseDoc(text, BASE_INDEX);
    setDocText(text);
    setOps(parsed.ops);
    setBase(parsed.base);
    setGsis(parsed.gsis);
    setNotes(parsed.notes);
    setOpLines(parsed.opLines);
    setAps(parsed.aps);
    setStep(parsed.ops.length);
    setDocVersion((v) => v + 1); // remount the editor with the loaded text
  }, []);

  const reset = useCallback(() => {
    const parsed = parseDoc(EMPTY_DOC, BASE_INDEX);
    setOps([]);
    setDocText(EMPTY_DOC);
    setStep(0);
    setBase(parsed.base);
    setGsis(parsed.gsis);
    setNotes(parsed.notes);
    setOpLines(parsed.opLines);
    setAps(parsed.aps);
    setDocVersion((v) => v + 1); // remount the editor if it's open
  }, []);

  // The whole model (structure + data) as DSL text.
  const serialize = (someOps: Op[]) => serializeModel(base, gsis, aps, someOps);
  // Reflect the current ops as editor text (entering the editor from canvas).
  const syncDoc = () => setDocText(serialize(ops));

  // Add a blank item at the scrubber head and reflect it in the doc; returns the
  // new item's label so the caller can pin it. Pure to the model (no mode/pin).
  const addItem = (pkValue: string): string => {
    const id = nextItemLabel(ops);
    const attrs: Record<string, string> = { [base.pk]: pkValue };
    if (base.sk) attrs[base.sk] = `ITEM#${id}`;
    const put: Op = { kind: "put", item: { id, attrs } };
    const newOps = [...ops.slice(0, curStep), put];
    setOps(newOps);
    setStep(newOps.length);
    setDocText(serialize(newOps));
    return id;
  };

  // ---- projections ----------------------------------------------------------
  const state = useMemo(() => fold(ops.slice(0, curStep), base), [ops, curStep, base]);
  // The FINISHED model (all ops), regardless of scrubber position: access-pattern
  // coverage is about the design as a whole, not the mid-playback moment.
  const fullState = useMemo(() => fold(ops, base), [ops, base]);
  const prevState = useMemo(
    () => fold(ops.slice(0, Math.max(0, curStep - 1)), base),
    [ops, curStep, base],
  );

  // How many declared patterns the design does NOT yet serve, drives the rail
  // badge (the "something to react to" signal).
  const apUnserved = useMemo(() => {
    const idx = [base, ...gsis];
    return aps.reduce(
      (n, ap) => n + (apCoverage(ap, idx, fullState).status === "served" ? 0 : 1),
      0,
    );
  }, [aps, base, gsis, fullState]);

  const paneNames = useMemo(() => [base.name, ...gsis.map((g) => g.name)], [base, gsis]);

  const baseView = useMemo(() => project(state, base), [state, base]);
  const prevBaseView = useMemo(() => project(prevState, base), [prevState, base]);
  // One view per declared GSI.
  const gsiViews = useMemo(
    () =>
      gsis.map((g) => ({
        index: g,
        view: project(state, g, base),
        prev: project(prevState, g, base),
      })),
    [gsis, state, prevState, base],
  );

  const cost = useMemo<OpCost | null>(() => {
    if (curStep < 1) return null;
    return writeCost(prevState, ops[curStep - 1], base, gsis);
  }, [prevState, ops, curStep, base, gsis]);

  // Backfill suggestion: schema drift within an entity, at the head of the log.
  const backfill = useMemo(
    () => (curStep === ops.length ? computeBackfill(state, base) : null),
    [state, curStep, ops.length, base],
  );

  const dirty = docText !== EMPTY_DOC || ops.length > 0;

  return {
    // raw model
    ops,
    docText,
    docVersion,
    base,
    gsis,
    aps,
    notes,
    opLines,
    step,
    curStep,
    setStep,
    dirty,
    // producers
    commit,
    onDoc,
    load,
    reset,
    serialize,
    syncDoc,
    addItem,
    // projections
    state,
    fullState,
    prevState,
    baseView,
    prevBaseView,
    gsiViews,
    cost,
    backfill,
    paneNames,
    apUnserved,
  };
}
