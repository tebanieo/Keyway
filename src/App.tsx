import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { fold, pkAttrs, project, skAttrs } from "./engine/engine";
import { itemSize } from "./engine/itemsize";
import { writeCost } from "./engine/cost";
import type { OpCost } from "./engine/cost";
import { diffPartitions } from "./engine/diff";
import type { DiffRow } from "./engine/diff";
import type { IndexSpec, Item, Op, View } from "./engine/types";
import { BASE_INDEX } from "./model/seed";
import { parseDoc, serializeAps, serializeGsis, serializeOps, serializeTable } from "./model/dsl";
import type { AccessPattern } from "./model/dsl";
import { apCoverage } from "./model/coverage";
import type { CoverageStatus } from "./model/coverage";
import { EMPTY_DOC } from "./model/doc";
import { modelFromLocation, SAFE_URL_LEN, shareUrl } from "./model/share";
import { EXAMPLES } from "./model/examples";
import { computeBackfill, putItemOf } from "./model/backfill";
import { Editor } from "./Editor";
import type { EditorHandle } from "./Editor";
import { QueryPanel } from "./QueryPanel";
import type { QueryHighlight } from "./QueryPanel";

type Mode = "canvas" | "editor";

/** Title-case a single-word action label (identifiers are shown verbatim). */
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Crisp inline icons (no dependency) that inherit color and animate fluidly. */
function Icon({ name }: { name: "play" | "pause" | "prev" | "next" | "patterns" | "examples" }) {
  const s = {
    width: 16,
    height: 16,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  switch (name) {
    case "play":
      return (
        <svg {...s} fill="currentColor" stroke="none">
          <path d="M8 5v14l11-7z" />
        </svg>
      );
    case "pause":
      return (
        <svg {...s} fill="currentColor" stroke="none">
          <rect x="6" y="5" width="4" height="14" rx="1" />
          <rect x="14" y="5" width="4" height="14" rx="1" />
        </svg>
      );
    case "prev":
      return (
        <svg {...s}>
          <path d="M15 6l-6 6 6 6" />
        </svg>
      );
    case "next":
      return (
        <svg {...s}>
          <path d="M9 6l6 6-6 6" />
        </svg>
      );
    case "patterns":
      return (
        <svg {...s}>
          <path d="M9 6h11M9 12h11M9 18h11" />
          <path d="M4.5 6h.01M4.5 12h.01M4.5 18h.01" />
        </svg>
      );
    case "examples":
      return (
        <svg {...s}>
          <rect x="3" y="3" width="7" height="7" rx="1.5" />
          <rect x="14" y="3" width="7" height="7" rx="1.5" />
          <rect x="3" y="14" width="7" height="7" rx="1.5" />
          <rect x="14" y="14" width="7" height="7" rx="1.5" />
        </svg>
      );
  }
}

/** A right-side glass drawer shell (header + close). Content is passed in, so
 *  new rail sections just drop their body inside one of these. */
function Drawer({
  open,
  title,
  head,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  head?: ReactNode;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <div className={open ? "drawer open" : "drawer"} aria-hidden={!open}>
      <div className="drawer-head">
        <span className="drawer-title">{title}</span>
        {head}
        <div className="spacer" />
        <button className="q-close" onClick={onClose} title="close">
          &times;
        </button>
      </div>
      {children}
    </div>
  );
}

/** Examples gallery as a rail drawer — same load path a shared link uses. */
function ExamplesDrawer({
  open,
  onClose,
  onLoad,
}: {
  open: boolean;
  onClose: () => void;
  onLoad: (dsl: string) => void;
}) {
  return (
    <Drawer open={open} title="Examples" onClose={onClose}>
      <div className="ex-list">
        {EXAMPLES.map((ex) => (
          <button
            key={ex.name}
            className="ex-item"
            onClick={() => {
              onLoad(ex.dsl);
              onClose();
            }}
          >
            <span className="ex-title">{ex.name}</span>
            <span className="ex-desc">{ex.description}</span>
          </button>
        ))}
      </div>
    </Drawer>
  );
}

/** One entry in the right activity rail. */
interface RailItem {
  id: string;
  label: string;
  icon: ReactNode;
  /** A count worth reacting to (e.g. uncovered patterns) → badge + attention. */
  badge?: number;
  active: boolean;
  onClick: () => void;
}

/**
 * A right-edge activity rail: the launcher for the side drawers. It tucks to a
 * slim pull-tab when nothing needs attention (hover to reveal), and auto-reveals
 * with a badge + pulse when an item has something to react to (an uncovered
 * access pattern today; query / warnings / helpers later).
 */
function RightRail({ items, reveal }: { items: RailItem[]; reveal?: boolean }) {
  const total = items.reduce((n, i) => n + (i.badge ?? 0), 0);
  // When the last badge clears (>0 → 0), flash a green "resolved" ✓ and keep the
  // rail out for a beat before it floats back to its tab — a reward for fixing it.
  const [resolved, setResolved] = useState(false);
  const prev = useRef(total);
  useEffect(() => {
    if (prev.current > 0 && total === 0) {
      setResolved(true);
      const t = window.setTimeout(() => setResolved(false), 1600);
      prev.current = total;
      return () => window.clearTimeout(t);
    }
    prev.current = total;
  }, [total]);

  if (items.length === 0) return null;
  const signal = total > 0 || resolved || reveal || items.some((i) => i.active);
  return (
    <div
      className={`rail${signal ? " revealed" : ""}${resolved ? " resolved" : ""}${reveal ? " hint" : ""}`}
    >
      {items.map((it) => {
        const badge = it.badge ?? 0;
        return (
          <button
            key={it.id}
            className={`rail-btn${it.active ? " active" : ""}${badge > 0 ? " warn" : ""}${resolved ? " ok" : ""}`}
            onClick={it.onClick}
            title={it.label}
            aria-label={it.label}
          >
            {it.icon}
            {badge > 0 && <span className="rail-badge">{badge}</span>}
            {resolved && badge === 0 && <span className="rail-badge ok">✓</span>}
            <span className="rail-label">{it.label}</span>
          </button>
        );
      })}
    </div>
  );
}

/** Short label for an index's projection, shown in the pane subtitle. */
function projLabel(index: IndexSpec): string {
  const p = index.projection;
  if (p === undefined || p === "ALL") return "ALL";
  if (p === "KEYS_ONLY") return "KEYS_ONLY";
  return `INCLUDE(${p.join(",")})`;
}

const MARKER: Record<string, string> = {
  added: "+",
  removed: "−", // minus sign
  modified: "~",
  same: "",
};

/**
 * Next free `i1`, `i2`, … label for a new canvas-created item. It doubles as the
 * item's stable id AND its DSL label when serialized to the editor, so it must
 * be grammar-valid — a UUID has hyphens and breaks the label rule.
 */
function nextItemLabel(ops: readonly Op[]): string {
  const used = new Set<string>();
  for (const op of ops) {
    const it = putItemOf(op);
    if (it) used.add(it.id);
    else if (op.kind === "delete") used.add(op.id);
  }
  let n = 1;
  while (used.has(`i${n}`)) n++;
  return `i${n}`;
}

/**
 * Turn a single cell edit into ops. A non-key change is one clean `put`. A base
 * key change is identity-changing, which DynamoDB models as an atomic
 * TransactWriteItems (delete old + put new) — billed at 2× base.
 */
function editToOps(item: Item, key: string, value: string, base: IndexSpec): Op[] {
  const attrs = { ...item.attrs, [key]: value };
  const next: Item = { id: item.id, attrs };
  if (key === base.pk || key === base.sk) {
    return [
      { kind: "transact", actions: [{ kind: "delete", id: item.id }, { kind: "put", item: next }] },
    ];
  }
  return [{ kind: "put", item: next }];
}

interface LinkProps {
  hoveredId: string | null;
  pinnedId: string | null;
  onHover: (id: string | null) => void;
  onPin: (id: string) => void;
  onCopy: (value: string) => void;
}

interface EditProps {
  onEdit: (item: Item, key: string, value: string) => void;
  onDelete: (id: string) => void;
  onAddItem: (pkValue: string) => void;
}

function keyLabel(attrs: Record<string, string>, base: IndexSpec): string {
  const pk = attrs[base.pk] ?? "?";
  return base.sk ? `${pk} / ${attrs[base.sk] ?? "?"}` : pk;
}

function describe(op: Op | undefined, base: IndexSpec): { verb: string; detail: string } {
  if (!op) return { verb: "start", detail: "empty table" };
  if (op.kind === "delete") return { verb: "delete", detail: op.id };
  if (op.kind === "transact") {
    const p = op.actions.find((a) => a.kind === "put");
    const a = p?.kind === "put" ? p.item.attrs : undefined;
    return { verb: "transact", detail: a ? `${keyLabel(a, base)} (key change)` : "delete + put" };
  }
  return { verb: "put", detail: keyLabel(op.item.attrs, base) };
}

function unionKeys(rows: DiffRow[], index: IndexSpec): string[] {
  const seen = new Set<string>();
  for (const r of rows) for (const k of Object.keys(r.item.attrs)) seen.add(k);
  const lead = [...pkAttrs(index), ...skAttrs(index)].filter((k) => seen.has(k));
  const rest = [...seen].filter((k) => !lead.includes(k)).sort();
  return [...lead, ...rest];
}

function isKeyAttr(k: string, index: IndexSpec): boolean {
  return pkAttrs(index).includes(k) || skAttrs(index).includes(k);
}

export function App() {
  const [ops, setOps] = useState<Op[]>([]);
  const [docText, setDocText] = useState(EMPTY_DOC);
  // Bumped only when the doc is REPLACED externally (load/reset) — used as the
  // editor's React key so it remounts with the new text. Typing must not bump it.
  const [docVersion, setDocVersion] = useState(0);
  const [mode, setMode] = useState<Mode>("canvas");
  const [step, setStep] = useState(0);
  // The editor is the hero; collapsing its header hands the screen to the tables
  // (authors work up top, viewers focus on the panes below).
  const [editorCollapsed, setEditorCollapsed] = useState(false);
  const [pane, setPane] = useState<string>("split"); // "base" | "split" | gsi name
  const [diffOn, setDiffOn] = useState(true);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [pinnedId, setPinnedId] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [dismissedBackfill, setDismissedBackfill] = useState<string | null>(null);
  const [shareMsg, setShareMsg] = useState<string | null>(null);
  // Which right-rail drawer is open (only one at a time — they share the edge).
  const [drawer, setDrawer] = useState<null | "patterns" | "examples">(null);
  const [queryOpen, setQueryOpen] = useState(false);
  const [qhl, setQhl] = useState<QueryHighlight>({ matched: new Set(), scanned: new Set() });
  const [notes, setNotes] = useState<(string | undefined)[]>(
    () => parseDoc(EMPTY_DOC, BASE_INDEX).notes,
  );
  const [aps, setAps] = useState<AccessPattern[]>(
    () => parseDoc(EMPTY_DOC, BASE_INDEX).aps,
  );
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
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

  // Auto-play: advance one step on a timer while playing; stop at the end.
  useEffect(() => {
    if (!playing) return;
    if (curStep >= ops.length) {
      setPlaying(false);
      return;
    }
    const id = window.setTimeout(() => setStep((s) => s + 1), 1300 / speed);
    return () => window.clearTimeout(id);
  }, [playing, curStep, ops.length, speed]);

  // The whole model (structure + data) as DSL text.
  const modelToText = (someOps: Op[]) =>
    serializeTable(base) + serializeGsis(gsis) + serializeAps(aps) + "\n" + serializeOps(someOps, base);

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

  const togglePlay = () => {
    if (curStep >= ops.length) setStep(0); // replay from the top
    setPlaying((p) => !p);
  };

  // The model as text, whichever mode we're in (canvas serializes ops back).
  const currentDoc = () => (editing ? docText : modelToText(ops));

  const onShare = async () => {
    const url = shareUrl(currentDoc());
    if (url.length > SAFE_URL_LEN) {
      setShareMsg("model too large to link — copy the text instead");
    } else {
      try {
        await navigator.clipboard.writeText(url);
        setShareMsg("link copied to clipboard");
      } catch {
        setShareMsg("couldn't copy — link logged to console");
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

  return (
    <div className="app">
      <div className="toolbar">
        <h1>data-canvas</h1>

        <div className="seg">
          {(["canvas", "editor"] as Mode[]).map((m) => (
            <button
              key={m}
              className={m === mode ? "active" : ""}
              onClick={() => (m === "editor" ? enterEditor() : setMode("canvas"))}
            >
              {cap(m)}
            </button>
          ))}
        </div>

        <div className="seg">
          {[base.name, ...gsis.map((g) => g.name), "split"].map((p) => (
            <button
              key={p}
              className={p === pane ? "active" : ""}
              onClick={() => setPane(p)}
            >
              {p === "split" ? "Split" : p}
            </button>
          ))}
        </div>

        <div className="seg">
          <button
            className={diffOn ? "active" : ""}
            onClick={() => setDiffOn((v) => !v)}
          >
            Diff
          </button>
        </div>

        <div className="seg">
          <button
            className={queryOpen ? "active" : ""}
            onClick={() => setQueryOpen((v) => !v)}
          >
            Query
          </button>
        </div>

        <button className="share" onClick={onShare} title="copy a shareable link to this model">
          Share
        </button>
        {shareMsg && <span className="share-msg">{shareMsg}</span>}

        {dirty && (
          <button className="reset" onClick={reset}>
            Reset
          </button>
        )}

        {pinnedId && (
          <button className="pin-chip" onClick={() => setPinnedId(null)}>
            <span className="dot" />
            Pinned <code>{pinnedId.slice(0, 8)}</code>
            <span className="x">&times;</span>
          </button>
        )}

        <div className="spacer" />

        <div className="op-label">
          step {curStep}/{ops.length} &middot; <b>{op.verb}</b> {op.detail}
        </div>
        <div className="stepper">
          <button
            disabled={curStep === 0}
            onClick={() => {
              setPlaying(false);
              setStep(curStep - 1);
            }}
            title="step back"
          >
            <Icon name="prev" />
          </button>
          <button className="play" onClick={togglePlay} title="auto-play">
            <Icon name={playing ? "pause" : "play"} />
          </button>
          <button
            disabled={curStep === ops.length}
            onClick={() => {
              setPlaying(false);
              setStep(curStep + 1);
            }}
            title="step forward"
          >
            <Icon name="next" />
          </button>
          <select
            className="speed"
            value={speed}
            onChange={(e) => setSpeed(Number(e.target.value))}
            title="playback speed"
          >
            <option value={0.5}>0.5&times;</option>
            <option value={1}>1&times;</option>
            <option value={2}>2&times;</option>
          </select>
        </div>
      </div>

      {editing && (
        <div className={editorCollapsed ? "editor-wrap collapsed" : "editor-wrap"}>
          <button
            className="editor-head"
            onClick={() => setEditorCollapsed((v) => !v)}
            title={editorCollapsed ? "expand the editor" : "collapse the editor — focus the tables"}
          >
            <span className="chev" aria-hidden>
              ▸
            </span>
            <span className="eh-title">Editor</span>
            <span className="eh-stats">
              {fullState.size === 0 ? (
                "empty — load an example or start typing"
              ) : (
                <>
                  <b>{fullState.size}</b> {fullState.size === 1 ? "item" : "items"}
                  <i className="sep">·</i>
                  <b>{1 + gsis.length}</b> {1 + gsis.length === 1 ? "index" : "indexes"}
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
            not all &mdash; add it to the {backfill.targets.length} without
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

      {queryOpen && (
        <QueryPanel
          base={base}
          gsis={gsis}
          state={state}
          onHighlight={setQhl}
          onClose={() => {
            setQueryOpen(false);
            setQhl({ matched: new Set(), scanned: new Set() });
          }}
        />
      )}

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
        <div className="narration" key={curStep}>
          <span className="narr-step">{curStep}</span>
          <span className="narr-text">{narration}</span>
        </div>
      )}

      <CostBar cost={cost} bytes={opBytes} />

      {pane === "split" ? (
        <div className="split">
          <Panel
            view={baseView}
            prev={prevBaseView}
            diffOn={diffOn}
            link={link}
            edit={baseEdit}
            query={qhl}
            focusId={focusId}
            subtitle={editing ? "you write here · via script" : "you write here"}
          />
          {gsiViews.map((gv) => (
            <Panel
              key={gv.index.name}
              view={gv.view}
              prev={gv.prev}
              diffOn={diffOn}
              link={link}
              query={qhl}
              focusId={focusId}
              subtitle={`read-only · ${projLabel(gv.index)}`}
            />
          ))}
        </div>
      ) : pane === base.name ? (
        <Panel
          view={baseView}
          prev={prevBaseView}
          diffOn={diffOn}
          link={link}
          edit={baseEdit}
          query={qhl}
          focusId={focusId}
        />
      ) : (
        (() => {
          const gv = gsiViews.find((g) => g.index.name === pane) ?? gsiViews[0];
          return gv ? (
            <Panel
              view={gv.view}
              prev={gv.prev}
              diffOn={diffOn}
              link={link}
              query={qhl}
              focusId={focusId}
              subtitle={`read-only · ${projLabel(gv.index)}`}
            />
          ) : (
            <Panel view={baseView} prev={prevBaseView} diffOn={diffOn} link={link} query={qhl} focusId={focusId} />
          );
        })()
      )}

      <p className="hint">
        {editing ? (
          <>
            Type in the script above &mdash; <code>item</code>+Tab scaffolds a row.
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

/** How each coverage status renders: mark glyph + severity class. */
const COVER_UI: Record<CoverageStatus, { mark: string; kind: "ok" | "warn" | "bad" }> = {
  served: { mark: "✓", kind: "ok" },
  empty: { mark: "⚠", kind: "warn" },
  invalid: { mark: "⚠", kind: "warn" },
  assigned: { mark: "~", kind: "warn" },
  "no-index": { mark: "✗", kind: "bad" },
  unassigned: { mark: "✗", kind: "bad" },
};

/**
 * The access-pattern SPEC + coverage (v2). Each `@ap` carries a declared query
 * (`-> Index` + key conditions); we RUN it against the finished model and grade
 * the result — served / empty / invalid / assigned / gap. This is the original
 * "does my design serve all my access patterns?" validation, and an invalid
 * query shows the exact key rule it broke.
 */
function AccessPatterns({
  open,
  aps,
  base,
  gsis,
  state,
  onClose,
}: {
  open: boolean;
  aps: AccessPattern[];
  base: IndexSpec;
  gsis: IndexSpec[];
  state: Map<string, Item>;
  onClose: () => void;
}) {
  const indexes = [base, ...gsis];
  const rows = aps.map((ap) => ({ ap, cov: apCoverage(ap, indexes, state) }));
  const served = rows.filter((r) => r.cov.status === "served").length;
  const gaps = rows.filter((r) => COVER_UI[r.cov.status].kind === "bad").length;

  return (
    <Drawer
      open={open}
      title="Access Patterns"
      onClose={onClose}
      head={
        <>
          <span className={served === aps.length ? "ap-count all" : "ap-count"}>
            {served}/{aps.length} served
          </span>
          {gaps > 0 && <span className="ap-gaps">{gaps} unserved</span>}
        </>
      }
    >
      <div className="ap-list">
        {rows.map(({ ap, cov }) => {
          const ui = COVER_UI[cov.status];
          return (
            <div className={`ap-row ${ui.kind}`} key={ap.n}>
              <div className="ap-row-top">
                <span className={`ap-mark ${ui.kind}`}>{ui.mark}</span>
                <span className="ap-n">AP{ap.n}</span>
                <span className="ap-desc">{ap.description}</span>
                {ap.index && <span className="ap-idx">{ap.index}</span>}
              </div>
              <div className={`ap-msg ${ui.kind}`}>{cov.message}</div>
            </div>
          );
        })}
      </div>
      <div className="ap-foot">
        Declare with <code>@ap description -&gt; Index key=value</code>. Coverage runs the
        query — <b>served</b> means it returns data.
      </div>
    </Drawer>
  );
}

const EFFECT_WORD: Record<string, string> = {
  none: "unchanged",
  insert: "insert",
  delete: "delete",
  update: "update",
  reindex: "reindex",
};

function CostBar({ cost, bytes }: { cost: OpCost | null; bytes: number }) {
  if (!cost) {
    return (
      <div className="costbar">
        <span className="idle">empty table &mdash; step forward or add an item</span>
      </div>
    );
  }
  return (
    <div className="costbar">
      <span className="total">
        <b>{cost.totalWrites}</b>
        <span className="unit">WCU</span>
      </span>
      {bytes > 0 && (
        <span className="item-bytes">
          item <b>{bytes}</b> b
        </span>
      )}
      <span className={cost.transactional ? "seg-cost eff-box eff-tx" : "seg-cost"}>
        <span className="idx">base</span>
        <span className="eff eff-write">{cost.base}</span>
        {cost.transactional && <span className="tx-badge">TX &times;2</span>}
        <span className="w">{cost.baseWrites}</span>
      </span>
      {cost.indexes.map((i) => (
        <span className={`seg-cost eff-box eff-${i.effect}`} key={i.index}>
          <span className="idx">{i.index}</span>
          <span className={`eff eff-${i.effect}`}>{EFFECT_WORD[i.effect]}</span>
          {i.from && i.to ? (
            <span className="move">
              <code>{i.from}</code>
              <span className="arrow">&rarr;</span>
              <code>{i.to}</code>
            </span>
          ) : i.to ? (
            <code>{i.to}</code>
          ) : i.from ? (
            <code>{i.from}</code>
          ) : null}
          <span className="w">{i.writes}</span>
        </span>
      ))}
    </div>
  );
}

function Panel({
  view,
  prev,
  diffOn,
  link,
  edit,
  subtitle,
  query,
  focusId,
}: {
  view: View;
  prev: View;
  diffOn: boolean;
  link: LinkProps;
  edit?: EditProps;
  subtitle?: string;
  query?: QueryHighlight;
  focusId?: string | null;
}) {
  const index = view.index;
  const parts = diffOn
    ? diffPartitions(prev, view, index)
    : view.partitions.map((p) => ({
        pk: p.pk,
        rows: p.items.map((it): DiffRow => ({ item: it, status: "same" })),
      }));
  const total = view.partitions.reduce((n, p) => n + p.items.length, 0);

  return (
    <div className="panel">
      <div className="panel-title">
        <span className="idx">{index.name}</span>
        {subtitle && <span className="sub">{subtitle}</span>}
        <span className="count">{total} items</span>
      </div>
      <div className="partitions">
        {parts.length === 0 &&
          (edit ? (
            <div className="empty">
              <span>empty table — add an item, author in the editor, or load an example</span>
              <button className="add-item" onClick={() => edit.onAddItem("ITEM#1")}>
                + add an item
              </button>
            </div>
          ) : (
            <div className="empty">no items under this index</div>
          ))}
        {parts.map((part) => (
          <div className="partition" key={`${index.name}:${part.pk}`}>
            <div className="partition-head">
              <span className="pk">{part.pk}</span>
              <span className="count">
                {part.rows.filter((r) => r.status !== "removed").length} items
              </span>
              {edit && (
                <button
                  className="add-item"
                  title="add an item to this partition"
                  onClick={() => edit.onAddItem(part.pk)}
                >
                  + item
                </button>
              )}
            </div>
            <GridRows rows={part.rows} index={index} link={link} edit={edit} gutter={diffOn} query={query} focusId={focusId} />
          </div>
        ))}
      </div>
    </div>
  );
}

function GridRows({
  rows,
  index,
  link,
  edit,
  gutter,
  query,
  focusId,
}: {
  rows: DiffRow[];
  index: IndexSpec;
  link: LinkProps;
  edit?: EditProps;
  gutter: boolean;
  query?: QueryHighlight;
  focusId?: string | null;
}) {
  const cols = unionKeys(rows, index);
  return (
    <table className="ptable">
      <thead>
        <tr>
          {gutter && <th className="gutter" />}
          {cols.map((k) => (
            <th className={isKeyAttr(k, index) ? "iskey" : ""} key={k}>
              {k}
            </th>
          ))}
          <th className="actions" />
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => {
          const it: Item = r.item;
          const pinned = it.id === link.pinnedId ? " pinned" : "";
          const hovered = it.id === link.hoveredId ? " hovered" : "";
          const q = query?.matched.has(it.id)
            ? " q-matched"
            : query?.scanned.has(it.id)
              ? " q-read"
              : "";
          const dim = focusId && it.id !== focusId ? " dimmed" : "";
          const removed = r.status === "removed";
          return (
            <tr
              key={`${removed ? "x" : ""}${it.id}`}
              className={`row-${r.status}${pinned}${hovered}${q}${dim}`}
              onMouseEnter={() => link.onHover(it.id)}
              onMouseLeave={() => link.onHover(null)}
            >
              {gutter && <td className="gutter">{MARKER[r.status]}</td>}
              {cols.map((k) => {
                const val = it.attrs[k] ?? "";
                const key = isKeyAttr(k, index);
                if (edit && !removed) {
                  return (
                    <EditableCell
                      key={k}
                      value={val}
                      isKey={key}
                      onCommit={(v) => edit.onEdit(it, k, v)}
                      onCopy={link.onCopy}
                    />
                  );
                }
                const cls = (key ? "iskey" : val ? "" : "blank") + (val ? " copyable" : "");
                return (
                  <td
                    className={cls}
                    key={k}
                    title={val ? "click to copy" : undefined}
                    onClick={() => val && link.onCopy(val)}
                  >
                    {val}
                  </td>
                );
              })}
              <td className="actions">
                <button
                  className={link.pinnedId === it.id ? "pin-btn on" : "pin-btn"}
                  title="pin / follow this item"
                  onClick={(e) => {
                    e.stopPropagation();
                    link.onPin(it.id);
                  }}
                />
                {edit && !removed && (
                  <button
                    className="del-btn"
                    title="delete item"
                    onClick={(e) => {
                      e.stopPropagation();
                      edit.onDelete(it.id);
                    }}
                  >
                    &times;
                  </button>
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function EditableCell({
  value,
  isKey,
  onCommit,
  onCopy,
}: {
  value: string;
  isKey: boolean;
  onCommit: (v: string) => void;
  onCopy: (v: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const base = isKey ? "iskey editable" : value ? "editable" : "blank editable";
  const cls = value ? `${base} copyable` : base;

  if (editing) {
    return (
      <td className={isKey ? "iskey" : ""}>
        <input
          className="cell-input"
          autoFocus
          defaultValue={value}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              onCommit(e.currentTarget.value);
              setEditing(false);
            } else if (e.key === "Escape") {
              setEditing(false);
            }
          }}
          onBlur={(e) => {
            onCommit(e.currentTarget.value);
            setEditing(false);
          }}
        />
      </td>
    );
  }

  return (
    <td
      className={cls}
      title={value ? "click to copy · double-click to edit" : "double-click to edit"}
      onClick={() => value && onCopy(value)}
      onDoubleClick={() => setEditing(true)}
    >
      {value}
    </td>
  );
}
