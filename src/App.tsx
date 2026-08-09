import { useCallback, useEffect, useRef, useState } from "react";
import { itemSize } from "./engine/itemsize";
import { Icon } from "./components/icons";
import { Toolbar } from "./components/Toolbar";
import type { Mode } from "./components/Toolbar";
import { CostBar } from "./components/CostBar";
import { Panel, projLabel } from "./components/Panel";
import type { EditProps } from "./components/Panel";
import { RightRail } from "./components/Rail";
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
import { Editor } from "./components/Editor";
import type { EditorHandle } from "./components/Editor";
import { QueryPanel } from "./components/QueryPanel";

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

  const [mode, setMode] = useState<Mode>("canvas");
  const { theme, toggle: toggleTheme } = useTheme();
  // The editor is the hero; collapsing its header hands the screen to the tables
  // (authors work up top, viewers focus on the panes below).
  const [editorCollapsed, setEditorCollapsed] = useState(false);
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
  const { playing, setPlaying, speed, setSpeed, togglePlay, costPulse, pulseCost } = usePlayback(
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

  const reset = () => {
    resetModel();
    setPinnedId(null);
    setPlaying(false);
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
        onShare={() => openShare(currentDoc())}
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
            <Editor
              key={docVersion}
              ref={editorRef}
              initialDoc={docText}
              onChange={onDoc}
              activeLine={activeLine}
            />
          </div>
        </div>
      )}

      {showBackfill && backfill && (
        <div className="backfill">
          <span className="msg">
            <code>{backfill.attr}</code> is on some <b>{backfill.type}</b> items but not all. Add it
            to the {backfill.targets.length} without
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
        onClose={closeDrawer}
      />

      <RightRail
        reveal={ops.length === 0}
        items={[
          {
            id: "examples",
            label: "Examples",
            icon: <Icon name="examples" />,
            active: drawer === "examples",
            onClick: () => toggleDrawer("examples"),
          },
          {
            id: "learn",
            label: "Learn",
            icon: <Icon name="learn" />,
            active: drawer === "learn",
            onClick: () => toggleDrawer("learn"),
          },
          // Query only appears once there's data: you can't query an empty table.
          ...(fullState.size > 0
            ? [
                {
                  id: "query",
                  label: "Read / Query",
                  icon: <Icon name="query" />,
                  active: drawer === "query",
                  onClick: () => toggleDrawer("query"),
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
                  onClick: () => toggleDrawer("patterns"),
                },
              ]
            : []),
          // Docs opens the VitePress site in a new tab, so it never owns a drawer.
          {
            id: "docs",
            label: "Docs",
            icon: <Icon name="docs" />,
            active: false,
            onClick: () => window.open(`${import.meta.env.BASE_URL}docs/`, "_blank", "noopener"),
          },
        ]}
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

      {narration && (playing || costPulse) && (
        <div
          className={cost?.rejected ? "narration rejected" : "narration"}
          key={`narr-${curStep}`}
        >
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
          <button
            className={compact ? "active" : ""}
            onClick={() => setCompact((v) => !v)}
            title="tighten rows so larger models fit on screen"
          >
            Compact
          </button>
        </div>
      </div>

      <div className={compact ? "panes compact" : "panes"}>
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
            Type in the script above. <code>item</code>+Tab scaffolds a row. Add{" "}
            <code>@gsi GSI2 pk=GSI2PK sk=GSI2SK projection=keys</code> and a new pane appears. Each{" "}
            <code>@gsi</code> sets its own projection (<code>all</code>/<code>keys</code>
            /comma-list). Panes reparse live.
          </>
        ) : (
          <>
            Double-click a base cell to edit; click a row to pin and follow it. Switch to{" "}
            <b>editor</b> to author the same model as text.
          </>
        )}
      </p>

      <footer className="app-footer">
        <span className="disclaimer">
          A personal project. Opinions are my own, not those of AWS or Amazon.{" "}
          <a href="https://github.com/tebanieo/Keyway" target="_blank" rel="noopener noreferrer">
            Source
          </a>
          .
        </span>
        <span className="copyright">© 2026 tebanieo</span>
      </footer>

      <ShareDialog
        open={shareUrlValue !== null}
        url={shareUrlValue ?? ""}
        copied={shareCopied}
        onCopy={copyShareLink}
        onClose={closeShare}
      />

      {copied !== null && (
        <div className="copied-toast">
          copied <code>{copied}</code>
        </div>
      )}
    </div>
  );
}
