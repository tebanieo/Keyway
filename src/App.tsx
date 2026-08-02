import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fold, project } from "./engine/engine";
import { itemSize } from "./engine/itemsize";
import { writeCost } from "./engine/cost";
import type { OpCost } from "./engine/cost";
import type { IndexSpec, Op } from "./engine/types";
import { Icon } from "./components/icons";
import { Toolbar } from "./components/Toolbar";
import type { Mode } from "./components/Toolbar";
import { CostBar } from "./components/CostBar";
import { Panel, projLabel } from "./components/Panel";
import type { EditProps, LinkProps } from "./components/Panel";
import { RightRail } from "./components/Rail";
import { ExamplesDrawer } from "./components/ExamplesDrawer";
import { AccessPatterns } from "./components/AccessPatterns";
import { useTheme } from "./hooks/useTheme";
import { usePlayback } from "./hooks/usePlayback";
import { BASE_INDEX } from "./model/seed";
import { parseDoc, serializeModel } from "./model/dsl";
import type { AccessPattern } from "./model/dsl";
import { describe, editToOps, nextItemLabel } from "./model/actions";
import { apCoverage } from "./model/coverage";
import { EMPTY_DOC } from "./model/doc";
import { modelFromLocation, SAFE_URL_LEN, shareUrl } from "./model/share";
import { computeBackfill, putItemOf } from "./model/backfill";
import { Editor } from "./Editor";
import type { EditorHandle } from "./Editor";
import { QueryPanel } from "./QueryPanel";
import type { QueryHighlight } from "./QueryPanel";

export function App() {
  const [ops, setOps] = useState<Op[]>([]);
  const [docText, setDocText] = useState(EMPTY_DOC);
  // Bumped only when the doc is REPLACED externally (load/reset) — used as the
  // editor's React key so it remounts with the new text. Typing must not bump it.
  const [docVersion, setDocVersion] = useState(0);
  const [mode, setMode] = useState<Mode>("canvas");
  const { theme, toggle: toggleTheme } = useTheme();
  const [step, setStep] = useState(0);
  // The editor is the hero; collapsing its header hands the screen to the tables
  // (authors work up top, viewers focus on the panes below).
  const [editorCollapsed, setEditorCollapsed] = useState(false);
  // Which panes are shown (multi-select). Default = base + the last GSI; the
  // reconcile effect keeps it valid as the model's indexes change.
  const [visible, setVisible] = useState<Set<string>>(() => {
    const p = parseDoc(EMPTY_DOC, BASE_INDEX);
    const names = [p.base.name, ...p.gsis.map((g) => g.name)];
    return new Set([names[0], names[names.length - 1]].filter(Boolean));
  });
  const [diffOn, setDiffOn] = useState(true);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [pinnedId, setPinnedId] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [dismissedBackfill, setDismissedBackfill] = useState<string | null>(null);
  const [shareMsg, setShareMsg] = useState<string | null>(null);
  // Which right-rail drawer is open (only one at a time — they share the edge).
  const [drawer, setDrawer] = useState<null | "patterns" | "examples" | "query">(null);
  const [qhl, setQhl] = useState<QueryHighlight>({ matched: new Set(), scanned: new Set() });
  const [notes, setNotes] = useState<(string | undefined)[]>(
    () => parseDoc(EMPTY_DOC, BASE_INDEX).notes,
  );
  const [aps, setAps] = useState<AccessPattern[]>(
    () => parseDoc(EMPTY_DOC, BASE_INDEX).aps,
  );
  // Base table + secondary indexes, declared in the DSL (`@table` / `@gsi`).
  const [base, setBase] = useState<IndexSpec>(
    () => parseDoc(EMPTY_DOC, BASE_INDEX).base,
  );
  const [gsis, setGsis] = useState<IndexSpec[]>(
    () => parseDoc(EMPTY_DOC, BASE_INDEX).gsis,
  );
  const editorRef = useRef<EditorHandle>(null);

  const editing = mode === "editor";
  const curStep = Math.min(step, ops.length);
  const { playing, setPlaying, speed, setSpeed, togglePlay, costPulse, pulseCost } = usePlayback(
    curStep,
    ops.length,
    setStep,
  );

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
    setAps(parsed.aps);
  }, []);

  // Load a whole model from text (a shared link, or an example). Same path for
  // both — set the doc + parsed structure and open the editor.
  const loadModel = useCallback((text: string) => {
    const parsed = parseDoc(text, BASE_INDEX);
    setDocText(text);
    setOps(parsed.ops);
    setBase(parsed.base);
    setGsis(parsed.gsis);
    setNotes(parsed.notes);
    setAps(parsed.aps);
    setStep(parsed.ops.length);
    setPinnedId(null);
    setMode("editor");
    setDocVersion((v) => v + 1); // remount the editor with the loaded text
  }, []);

  // On open: if the URL carries a model (`#m=…`), load it.
  useEffect(() => {
    const shared = modelFromLocation(location.hash);
    if (shared) loadModel(shared);
  }, [loadModel]);

  // Query highlights (teal rows) only make sense while the Query drawer is open.
  useEffect(() => {
    if (drawer !== "query") setQhl({ matched: new Set(), scanned: new Set() });
  }, [drawer]);

  // Dismiss the open rail drawer when clicking anywhere outside the rail/drawer.
  useEffect(() => {
    if (!drawer) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Element | null;
      if (t && !t.closest(".rail") && !t.closest(".drawer")) setDrawer(null);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [drawer]);

  // The whole model (structure + data) as DSL text.
  const modelToText = (someOps: Op[]) => serializeModel(base, gsis, aps, someOps);

  const enterEditor = () => {
    setDocText(modelToText(ops)); // one source: reflect current state as text
    setMode("editor");
  };

  const edit: EditProps = {
    onEdit: (item, key, value) => {
      if ((item.attrs[key] ?? "") === value) return;
      commit(editToOps(item, key, value, base));
    },
    onDelete: (id) => commit([{ kind: "delete", id }]),
    // Add the item to the table AND open the editor — the table is for viewing,
    // the editor is where you author from here.
    onAddItem: (pkValue) => {
      const id = nextItemLabel(ops);
      const attrs: Record<string, string> = { [base.pk]: pkValue };
      if (base.sk) attrs[base.sk] = `ITEM#${id}`;
      const put: Op = { kind: "put", item: { id, attrs } };
      const newOps = [...ops.slice(0, curStep), put];
      setOps(newOps);
      setStep(newOps.length);
      setDocText(modelToText(newOps));
      setMode("editor");
      setPinnedId(id);
    },
  };

  const reset = () => {
    setOps([]);
    setDocText(EMPTY_DOC);
    setStep(0);
    const parsed = parseDoc(EMPTY_DOC, BASE_INDEX);
    setBase(parsed.base);
    setGsis(parsed.gsis);
    setNotes(parsed.notes);
    setAps(parsed.aps);
    setPinnedId(null);
    setPlaying(false);
    setDocVersion((v) => v + 1); // remount the editor if it's open
  };

  // The model as text, whichever mode we're in (canvas serializes ops back).
  const currentDoc = () => (editing ? docText : modelToText(ops));

  const onShare = async () => {
    const url = shareUrl(currentDoc());
    if (url.length > SAFE_URL_LEN) {
      setShareMsg("model too large to link - copy the text instead");
    } else {
      try {
        await navigator.clipboard.writeText(url);
        setShareMsg("link copied to clipboard");
      } catch {
        setShareMsg("couldn't copy - link logged to console");
        console.log(url);
      }
    }
    window.setTimeout(() => setShareMsg(null), 2600);
  };

  // ---- projections ----------------------------------------------------------
  const state = useMemo(() => fold(ops.slice(0, curStep), base), [ops, curStep, base]);
  // The FINISHED model (all ops), regardless of scrubber position — access-pattern
  // coverage is about the design as a whole, not the mid-playback moment.
  const fullState = useMemo(() => fold(ops, base), [ops, base]);
  // Close the Query drawer if the model empties out (e.g. reset while it's open).
  useEffect(() => {
    if (fullState.size === 0 && drawer === "query") setDrawer(null);
  }, [fullState.size, drawer]);
  // How many declared patterns the design does NOT yet serve — drives the rail
  // badge (the "something to react to" signal).
  const apUnserved = useMemo(() => {
    const idx = [base, ...gsis];
    return aps.reduce(
      (n, ap) => n + (apCoverage(ap, idx, fullState).status === "served" ? 0 : 1),
      0,
    );
  }, [aps, base, gsis, fullState]);
  const prevState = useMemo(
    () => fold(ops.slice(0, Math.max(0, curStep - 1)), base),
    [ops, curStep, base],
  );
  const paneNames = useMemo(() => [base.name, ...gsis.map((g) => g.name)], [base, gsis]);
  const namesKey = paneNames.join("|");
  // Reconcile the visible set when the index set changes (model load / @gsi edit):
  // drop panes that vanished; if nothing's left, default to base + the last GSI.
  useEffect(() => {
    const names = namesKey.split("|");
    setVisible((prev) => {
      const kept = new Set([...prev].filter((n) => names.includes(n)));
      return kept.size ? kept : new Set([names[0], names[names.length - 1]].filter(Boolean));
    });
  }, [namesKey]);

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

  // Backfill suggestion — schema drift within an entity, at the head of the log.
  const backfill = useMemo(
    () => (curStep === ops.length ? computeBackfill(state, base) : null),
    [state, curStep, ops.length, base],
  );
  const backfillSig = backfill ? `${backfill.type}.${backfill.attr}` : null;
  const showBackfill = backfill && backfillSig !== dismissedBackfill;

  const applyBackfill = () => {
    if (!backfill) return;
    if (editing) {
      // edit each target's line in place — no duplicate rows appended
      editorRef.current?.patchItems(
        backfill.targets.map((t) => ({
          label: t.id,
          append: `${backfill.attr}=${backfill.value}`,
        })),
      );
    } else {
      commit(
        backfill.targets.map((it) => ({
          kind: "put",
          item: { id: it.id, attrs: { ...it.attrs, [backfill.attr]: backfill.value } },
        })),
      );
    }
  };

  const curOp = ops[curStep - 1];
  const op = describe(curOp, base);
  const opItem = putItemOf(curOp);
  const opBytes = opItem ? itemSize(opItem) : 0;
  const narration = curStep >= 1 ? notes[curStep - 1] : undefined;
  // The item this step touches — spotlighted in focus mode.
  const affectedId = curOp
    ? curOp.kind === "delete"
      ? curOp.id
      : (putItemOf(curOp)?.id ?? null)
    : null;
  // Spotlight the touched item only while auto-playing (no standalone toggle).
  const focusId = playing ? affectedId : null;

  const link: LinkProps = {
    hoveredId,
    pinnedId,
    onHover: setHoveredId,
    onPin: (id) => setPinnedId((cur) => (cur === id ? null : id)),
    onCopy: (value) => {
      if (value === "") return;
      void navigator.clipboard?.writeText(value);
      setCopied(value);
      window.setTimeout(() => setCopied((c) => (c === value ? null : c)), 1400);
    },
  };
  const dirty = docText !== EMPTY_DOC || ops.length > 0;
  // Editing lives on the base pane, and only in canvas mode.
  const baseEdit = editing ? undefined : edit;

  const togglePane = (name: string) =>
    setVisible((prev) => {
      const next = new Set(prev);
      if (next.has(name)) {
        if (next.size > 1) next.delete(name); // always keep at least one pane
      } else next.add(name);
      return next;
    });
  const allVisible = visible.size === paneNames.length;
  const toggleAll = () =>
    setVisible(
      allVisible
        ? new Set([paneNames[0], paneNames[paneNames.length - 1]].filter(Boolean))
        : new Set(paneNames),
    );

  // The panes to render, in index order, filtered to the visible set.
  const shownPanes = [
    {
      name: base.name,
      view: baseView,
      prev: prevBaseView,
      edit: baseEdit,
      subtitle: editing ? "you write here · via script" : "you write here",
    },
    ...gsiViews.map((gv) => ({
      name: gv.index.name,
      view: gv.view,
      prev: gv.prev,
      edit: undefined as EditProps | undefined,
      subtitle: `read-only · ${projLabel(gv.index)}`,
    })),
  ].filter((p) => visible.has(p.name));

  const step1 = (delta: number) => {
    setPlaying(false);
    setStep(curStep + delta);
    pulseCost();
  };

  return (
    <div className="app">
      <Toolbar
        mode={mode}
        onMode={(m) => (m === "editor" ? enterEditor() : setMode("canvas"))}
        theme={theme}
        onToggleTheme={toggleTheme}
        onShare={onShare}
        shareMsg={shareMsg}
        dirty={dirty}
        onReset={reset}
        pinnedId={pinnedId}
        onUnpin={() => setPinnedId(null)}
        curStep={curStep}
        opsLength={ops.length}
        op={op}
        playing={playing}
        onTogglePlay={togglePlay}
        onPrev={() => step1(-1)}
        onNext={() => step1(1)}
        speed={speed}
        onSpeed={setSpeed}
      />

      {editing && (
        <div className={editorCollapsed ? "editor-wrap collapsed" : "editor-wrap"}>
          <button
            className="editor-head"
            onClick={() => setEditorCollapsed((v) => !v)}
            title={editorCollapsed ? "expand the editor" : "collapse the editor - focus the tables"}
          >
            <span className="chev" aria-hidden>
              ▸
            </span>
            <span className="eh-title">Editor</span>
            <span className="eh-stats">
              {fullState.size === 0 ? (
                "empty - load an example or start typing"
              ) : (
                <>
                  <b>{fullState.size}</b> {fullState.size === 1 ? "item" : "items"}
                  <i className="sep">·</i>
                  <b>{gsis.length}</b> {gsis.length === 1 ? "index" : "indexes"}
                  {aps.length > 0 && (
                    <>
                      <i className="sep">·</i>
                      <b>{aps.length}</b> {aps.length === 1 ? "pattern" : "patterns"}
                    </>
                  )}
                </>
              )}
            </span>
          </button>
          <div className="editor-body">
            <Editor key={docVersion} ref={editorRef} initialDoc={docText} onChange={onDoc} />
          </div>
        </div>
      )}

      {showBackfill && backfill && (
        <div className="backfill">
          <span className="msg">
            <code>{backfill.attr}</code> is on some <b>{backfill.type}</b> items but
            not all. Add it to the {backfill.targets.length} without
            {backfill.targets.length === 1 ? "" : ""} it?
          </span>
          <button className="do" onClick={applyBackfill}>
            backfill {backfill.targets.length}
          </button>
          <button className="ghost" onClick={() => setDismissedBackfill(backfillSig)}>
            dismiss
          </button>
        </div>
      )}

      <QueryPanel
        open={drawer === "query"}
        base={base}
        gsis={gsis}
        state={state}
        onHighlight={setQhl}
        onClose={() => setDrawer(null)}
      />

      <RightRail
        reveal={ops.length === 0}
        items={[
          {
            id: "examples",
            label: "Examples",
            icon: <Icon name="examples" />,
            active: drawer === "examples",
            onClick: () => setDrawer((d) => (d === "examples" ? null : "examples")),
          },
          // Query only appears once there's data — you can't query an empty table.
          ...(fullState.size > 0
            ? [
                {
                  id: "query",
                  label: "Read / Query",
                  icon: <Icon name="query" />,
                  active: drawer === "query",
                  onClick: () => setDrawer((d) => (d === "query" ? null : "query")),
                },
              ]
            : []),
          ...(aps.length > 0
            ? [
                {
                  id: "patterns",
                  label: "Access Patterns",
                  icon: <Icon name="patterns" />,
                  badge: apUnserved,
                  active: drawer === "patterns",
                  onClick: () => setDrawer((d) => (d === "patterns" ? null : "patterns")),
                },
              ]
            : []),
        ]}
      />

      <ExamplesDrawer
        open={drawer === "examples"}
        onClose={() => setDrawer(null)}
        onLoad={loadModel}
      />

      {aps.length > 0 && (
        <AccessPatterns
          open={drawer === "patterns"}
          aps={aps}
          base={base}
          gsis={gsis}
          state={fullState}
          onClose={() => setDrawer(null)}
        />
      )}

      {narration && (
        <div className="narration" key={`narr-${curStep}`}>
          <span className="narr-step">{curStep}</span>
          <span className="narr-text">{narration}</span>
        </div>
      )}

      {cost && (playing || costPulse) && (
        <div className="cost-hud" key={`cost-${curStep}`}>
          <CostBar cost={cost} bytes={opBytes} />
        </div>
      )}

      <div className="panes-bar">
        <div className="seg" title="toggle which panes are shown">
          {paneNames.map((name) => (
            <button
              key={name}
              className={visible.has(name) ? "active" : ""}
              onClick={() => togglePane(name)}
            >
              {name}
            </button>
          ))}
          {gsis.length > 0 && (
            <button className={allVisible ? "active" : ""} onClick={toggleAll}>
              All
            </button>
          )}
        </div>
        <div className="seg">
          <button className={diffOn ? "active" : ""} onClick={() => setDiffOn((v) => !v)}>
            Diff
          </button>
        </div>
      </div>

      <div className="panes">
        {shownPanes.map((p) => (
          <Panel
            key={p.name}
            view={p.view}
            prev={p.prev}
            diffOn={diffOn}
            link={link}
            edit={p.edit}
            query={qhl}
            focusId={focusId}
            subtitle={p.subtitle}
          />
        ))}
      </div>

      <p className="hint">
        {editing ? (
          <>
            Type in the script above. <code>item</code>+Tab scaffolds a row.
            Add <code>@gsi GSI2 pk=GSI2PK sk=GSI2SK projection=keys</code> and a new
            pane appears. Each <code>@gsi</code> sets its own projection
            (<code>all</code>/<code>keys</code>/comma-list). Panes reparse live.
          </>
        ) : (
          <>
            Double-click a base cell to edit; click a row to pin and follow it.
            Switch to <b>editor</b> to author the same model as text.
          </>
        )}
      </p>

      {copied !== null && (
        <div className="copied-toast">
          copied <code>{copied}</code>
        </div>
      )}
    </div>
  );
}
