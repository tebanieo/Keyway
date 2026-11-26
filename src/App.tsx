import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { parseDoc } from "./model/dsl";
import { BASE_INDEX } from "./model/seed";
import { itemSize } from "./engine/itemsize";
import { Toolbar } from "./components/Toolbar";
import type { Mode } from "./components/Toolbar";
import { projLabel } from "./components/Panel";
import type { EditProps } from "./components/Panel";
import { ExamplesDrawer } from "./components/ExamplesDrawer";
import { LearnDrawer } from "./components/LearnDrawer";
import type { Tour } from "./model/tours";
import { AccessPatterns } from "./components/AccessPatterns";
import { useTheme } from "./hooks/useTheme";
import { usePlayback } from "./hooks/usePlayback";
import { useModel } from "./hooks/useModel";
import { useSelection } from "./hooks/useSelection";
import { useShare } from "./hooks/useShare";
import { useDrawers } from "./hooks/useDrawers";
import { usePaneVisibility } from "./hooks/usePaneVisibility";
import { describe, editToOps } from "./model/actions";
import { modelFromLocation } from "./model/share";
import { ShareDialog } from "./components/ShareDialog";
import { putItemOf } from "./model/backfill";
import type { EditorHandle } from "./components/Editor";
import { QueryPanel } from "./components/QueryPanel";
import { EditorPane } from "./components/EditorPane";
import { BackfillBanner } from "./components/BackfillBanner";
import { AppRail } from "./components/AppRail";
import { StatusBar } from "./components/StatusBar";
import { totalWrites } from "./engine/cost";
import { PanesBar } from "./components/PanesBar";
import { PanesGrid } from "./components/PanesGrid";
import type { ShownPane } from "./components/PanesGrid";
import { AppHint, AppFooter, CopiedToast, ResetToast } from "./components/AppChrome";

export function App() {
  // The data model (op log + DSL structure + projections) lives in one hook;
  // App keeps the UI around it — modes, drawers, playback, pins, sharing —
  // each carved into its own focused hook below.
  const {
    ops,
    docText,
    docVersion,
    base,
    gsis,
    aps,
    notes,
    opLines,
    curStep,
    setStep,
    dirty,
    commit,
    onDoc,
    load,
    reset: resetModel,
    serialize,
    syncDoc,
    addItem,
    state,
    fullState,
    baseView,
    prevBaseView,
    gsiViews,
    cost,
    backfill,
    paneNames,
    apUnserved,
  } = useModel();

  // Type-first: the app opens in the editor (focused, caret at the end).
  const [mode, setMode] = useState<Mode>("editor");
  const { theme, toggle: toggleTheme } = useTheme();
  // The editor is the hero; collapsing its header hands the screen to the tables
  // (authors work up top, viewers focus on the panes below).
  const [editorCollapsed, setEditorCollapsed] = useState(false);
  // Phone width: one column, so the script and the tables take turns.
  const [narrowView, setNarrowView] = useState<"script" | "tables">("script");
  const [dismissedBackfill, setDismissedBackfill] = useState<string | null>(null);
  const editorRef = useRef<EditorHandle>(null);

  // UI-state hooks. Destructure the stable useState setters (link/toggle/close
  // are fresh each render, so keep those out of callback/effect deps below).
  const { link, pinnedId, setPinnedId, copied } = useSelection();
  const {
    url: shareUrlValue,
    copied: shareCopied,
    open: openShare,
    close: closeShare,
    copy: copyShareLink,
  } = useShare();
  const {
    drawer,
    setDrawer,
    toggle: toggleDrawer,
    close: closeDrawer,
    highlight: qhl,
    setHighlight: setQhl,
  } = useDrawers(fullState.size === 0);
  const {
    visible,
    diffOn,
    setDiffOn,
    compact,
    setCompact,
    toggle: togglePane,
    toggleAll,
    allVisible,
  } = usePaneVisibility(paneNames);

  const editing = mode === "editor";
  const { playing, setPlaying, speed, setSpeed, togglePlay } = usePlayback(
    curStep,
    ops.length,
    setStep,
  );

  // Load a whole model (a shared link, or an example): the hook resets the model
  // to it; App opens the editor and clears the pin around that.
  const loadModel = useCallback(
    (text: string) => {
      load(text);
      setPinnedId(null);
      setMode("editor");
    },
    [load, setPinnedId],
  );

  // Play a guided tour: load its curated model, then collapse the editor and
  // auto-play from step 0 so the tables are the focus and the narration reads
  // like a lesson. These setters batch, so the net effect is one clean start.
  const playTour = useCallback(
    (tour: Tour) => {
      loadModel(tour.dsl);
      setStep(0);
      // "editor" tours are about the tool: keep the script visible. The rest
      // collapse so the panes lead while the story plays.
      setEditorCollapsed(tour.focus !== "editor");
      setPlaying(true);
      setDrawer(null);
    },
    [loadModel, setStep, setPlaying, setDrawer],
  );

  // Load an example and play it like a tour: rewind to step 0, hand the screen
  // to the tables, and auto-play from the start (loadModel jumps to the end of
  // the script, so the batched setStep(0) rewinds it before playback begins).
  const playExample = useCallback(
    (dsl: string) => {
      loadModel(dsl);
      setStep(0);
      setEditorCollapsed(true);
      setPlaying(true);
    },
    [loadModel, setStep, setPlaying],
  );

  // On open: if the URL carries a model (`#m=…`), load it.
  useEffect(() => {
    const shared = modelFromLocation(location.hash);
    if (shared) loadModel(shared);
  }, [loadModel]);

  // The script's errors and warnings, counted for the editor header.
  const problems = useMemo(() => {
    const { diagnostics } = parseDoc(docText, BASE_INDEX);
    const errors = diagnostics.filter((d) => d.severity === "error").length;
    return { errors, warnings: diagnostics.length - errors };
  }, [docText]);

  const enterEditor = () => {
    syncDoc(); // one source: reflect current state as text
    setMode("editor");
  };

  const edit: EditProps = {
    onEdit: (item, key, value) => {
      if ((item.attrs[key] ?? "") === value) return;
      commit(editToOps(item, key, value, base));
    },
    onDelete: (id) => commit([{ kind: "delete", id }]),
    // Add the item to the table AND open the editor: the table is for viewing,
    // the editor is where you author from here.
    onAddItem: (pkValue) => {
      const id = addItem(pkValue);
      setMode("editor");
      setPinnedId(id);
    },
  };

  // Reset is one keypress and the model lives nowhere else, so keep the text
  // and offer it back for a while. The editor remounts focused, ready to type.
  const [undoReset, setUndoReset] = useState<string | null>(null);
  useEffect(() => {
    if (undoReset === null) return;
    const t = window.setTimeout(() => setUndoReset(null), 10_000);
    return () => window.clearTimeout(t);
  }, [undoReset]);
  const reset = () => {
    setUndoReset(currentDoc());
    resetModel();
    setPinnedId(null);
    setPlaying(false);
    setMode("editor");
  };

  // The model as text, whichever mode we're in (canvas serializes ops back).
  const currentDoc = () => (editing ? docText : serialize(ops));

  const backfillSig = backfill ? `${backfill.type}.${backfill.attr}` : null;
  const showBackfill = backfill && backfillSig !== dismissedBackfill;

  const applyBackfill = () => {
    if (!backfill) return;
    if (editing) {
      // edit each target's line in place: no duplicate rows appended
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

  // Write units of every step up to the current one (the status bar's total).
  // Editor <-> tables: the line under the caret lights its row (and scrolls it
  // into view); pinning a row reveals the line that wrote it.
  const opIdAt = (i: number): string | null => {
    const op = ops[i];
    if (!op) return null;
    const w = op.kind === "transact" ? op.actions.find((a) => a.kind === "put") : op;
    return !w ? null : w.kind === "put" ? w.item.id : w.id;
  };
  const onCaretLine = (line: number | null) => {
    const i = line == null ? -1 : opLines.indexOf(line);
    const id = i < 0 ? null : opIdAt(i);
    link.onHover(id);
    if (id) {
      document
        .querySelector(`.wb-tables tr[data-item="${CSS.escape(id)}"]`)
        ?.scrollIntoView({ block: "nearest" });
    }
  };
  useEffect(() => {
    if (!pinnedId || !editing) return;
    for (let i = ops.length - 1; i >= 0; i--) {
      if (opIdAt(i) === pinnedId) return editorRef.current?.revealLine(opLines[i]);
    }
    // Only when the pin changes, not on every edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pinnedId]);

  const totalWcu = useMemo(() => totalWrites(ops, base, gsis, curStep), [ops, base, gsis, curStep]);

  const curOp = ops[curStep - 1];
  const op = describe(curOp, base);
  const opItem = putItemOf(curOp);
  const opBytes = opItem ? itemSize(opItem) : 0;
  const narration = curStep >= 1 ? notes[curStep - 1] : undefined;
  // The editor line (1-based) the current step is running, so playback lights up
  // the source line instead of leaving the step number to be read against the
  // gutter (comments and directives take lines but aren't steps).
  const activeLine = curStep >= 1 && opLines[curStep - 1] != null ? opLines[curStep - 1] + 1 : null;
  // The item this step touches: spotlighted in focus mode.
  const affectedId = curOp
    ? curOp.kind === "delete"
      ? curOp.id
      : (putItemOf(curOp)?.id ?? null)
    : null;
  // Spotlight the touched item only while auto-playing (no standalone toggle).
  const focusId = playing ? affectedId : null;

  // Editing lives on the base pane, and only in canvas mode.
  const baseEdit = editing ? undefined : edit;

  // The panes to render, in index order, filtered to the visible set.
  const shownPanes: ShownPane[] = [
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
      edit: undefined,
      subtitle: `read-only · ${projLabel(gv.index)}`,
    })),
  ].filter((p) => visible.has(p.name));

  const step1 = (delta: number) => {
    setPlaying(false);
    setStep(curStep + delta);
  };

  return (
    // The workbench: a fixed-height frame (no page scroll) with the script and
    // the tables side by side, each scrolling on its own.
    <div
      className={`app wb${editing ? "" : " no-script"}${editing && editorCollapsed ? " script-collapsed" : ""}`}
    >
      <Toolbar
        mode={mode}
        onMode={(m) => (m === "editor" ? enterEditor() : setMode("canvas"))}
        theme={theme}
        onToggleTheme={toggleTheme}
        onShare={() => openShare(currentDoc())}
        dirty={dirty}
        onReset={reset}
        pinnedId={pinnedId}
        onUnpin={() => setPinnedId(null)}
      />

      {editing && (
        <div className="wb-switch" role="group" aria-label="Show">
          <button
            aria-pressed={narrowView === "script"}
            className={narrowView === "script" ? "active" : ""}
            onClick={() => {
              setNarrowView("script");
              setEditorCollapsed(false);
            }}
          >
            Script
          </button>
          <button
            aria-pressed={narrowView === "tables"}
            className={narrowView === "tables" ? "active" : ""}
            onClick={() => setNarrowView("tables")}
          >
            Tables
          </button>
        </div>
      )}

      <main
        className={drawer ? "wb-main dock-open" : "wb-main"}
        data-view={editing ? narrowView : "tables"}
      >
        {editing && (
          <section className="wb-script" aria-label="Script">
            <EditorPane
              ref={editorRef}
              collapsed={editorCollapsed}
              problems={problems}
              onOpenProblems={() => {
                setEditorCollapsed(false);
                editorRef.current?.openProblems();
              }}
              onToggleCollapse={() => setEditorCollapsed((v) => !v)}
              itemCount={fullState.size}
              gsiCount={gsis.length}
              apCount={aps.length}
              editorKey={docVersion}
              initialDoc={docText}
              onChange={onDoc}
              activeLine={activeLine}
              onCaretLine={onCaretLine}
            />
          </section>
        )}

        <section className="wb-tables" aria-label="Tables">
          {showBackfill && backfill && (
            <BackfillBanner
              backfill={backfill}
              onApply={applyBackfill}
              onDismiss={() => setDismissedBackfill(backfillSig)}
            />
          )}

          <PanesBar
            paneNames={paneNames}
            visible={visible}
            onTogglePane={togglePane}
            showAll={gsis.length > 0}
            allVisible={allVisible}
            onToggleAll={toggleAll}
            diffOn={diffOn}
            onToggleDiff={() => setDiffOn((v) => !v)}
            compact={compact}
            onToggleCompact={() => setCompact((v) => !v)}
          />

          <PanesGrid
            panes={shownPanes}
            compact={compact}
            diffOn={diffOn}
            link={link}
            query={qhl}
            focusId={focusId}
          />

          <AppHint editing={editing} />
        </section>
        {/* Panels dock beside the tables instead of covering them. */}
        <aside className="wb-dock" aria-label="Panels">
          <QueryPanel
            open={drawer === "query"}
            base={base}
            gsis={gsis}
            state={state}
            onHighlight={setQhl}
            onClose={closeDrawer}
          />

          <ExamplesDrawer open={drawer === "examples"} onClose={closeDrawer} onLoad={playExample} />

          <LearnDrawer open={drawer === "learn"} onClose={closeDrawer} onPlay={playTour} />

          {aps.length > 0 && (
            <AccessPatterns
              open={drawer === "patterns"}
              aps={aps}
              base={base}
              gsis={gsis}
              state={fullState}
              onClose={closeDrawer}
            />
          )}
        </aside>
      </main>

      <AppRail
        reveal={ops.length === 0}
        drawer={drawer}
        onToggle={toggleDrawer}
        hasData={fullState.size > 0}
        apCount={aps.length}
        apUnserved={apUnserved}
      />

      <StatusBar
        curStep={curStep}
        opsLength={ops.length}
        op={op}
        narration={narration}
        playing={playing}
        onTogglePlay={togglePlay}
        onPrev={() => step1(-1)}
        onNext={() => step1(1)}
        speed={speed}
        onSpeed={setSpeed}
        cost={cost}
        opBytes={opBytes}
        totalWcu={totalWcu}
      />

      <AppFooter />

      <ShareDialog
        open={shareUrlValue !== null}
        url={shareUrlValue ?? ""}
        copied={shareCopied}
        onCopy={copyShareLink}
        onClose={closeShare}
      />

      <CopiedToast value={copied} />

      <ResetToast
        onUndo={
          undoReset === null
            ? null
            : () => {
                loadModel(undoReset);
                setUndoReset(null);
              }
        }
      />
    </div>
  );
}
