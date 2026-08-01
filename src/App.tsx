import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fold, project } from "./engine/engine";
import { writeCost } from "./engine/cost";
import type { OpCost } from "./engine/cost";
import { diffPartitions } from "./engine/diff";
import type { DiffRow } from "./engine/diff";
import type { IndexSpec, Item, Op, View } from "./engine/types";
import { BASE_INDEX, SEED_OPS } from "./model/seed";
import { parseDoc, serializeGsis, serializeOps, serializeTable } from "./model/dsl";
import { DEFAULT_DOC } from "./model/doc";
import { modelFromLocation, SAFE_URL_LEN, shareUrl } from "./model/share";
import { computeBackfill } from "./model/backfill";
import { Editor } from "./Editor";
import type { EditorHandle } from "./Editor";

type Mode = "canvas" | "editor";

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

function newId(): string {
  return crypto.randomUUID();
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
  const lead = [index.pk, index.sk].filter(
    (k): k is string => Boolean(k) && seen.has(k as string),
  );
  const rest = [...seen].filter((k) => !lead.includes(k)).sort();
  return [...lead, ...rest];
}

function isKeyAttr(k: string, index: IndexSpec): boolean {
  return k === index.pk || k === index.sk;
}

export function App() {
  const [ops, setOps] = useState<Op[]>(SEED_OPS);
  const [docText, setDocText] = useState(DEFAULT_DOC);
  const [mode, setMode] = useState<Mode>("canvas");
  const [step, setStep] = useState(SEED_OPS.length);
  const [pane, setPane] = useState<string>("split"); // "base" | "split" | gsi name
  const [diffOn, setDiffOn] = useState(true);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [pinnedId, setPinnedId] = useState<string | null>(null);
  const [dismissedBackfill, setDismissedBackfill] = useState<string | null>(null);
  const [shareMsg, setShareMsg] = useState<string | null>(null);
  // Base table + secondary indexes, declared in the DSL (`@table` / `@gsi`).
  const [base, setBase] = useState<IndexSpec>(
    () => parseDoc(DEFAULT_DOC, BASE_INDEX).base,
  );
  const [gsis, setGsis] = useState<IndexSpec[]>(
    () => parseDoc(DEFAULT_DOC, BASE_INDEX).gsis,
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
  }, []);

  // Load a whole model from text (a shared link, or an example). Same path for
  // both — set the doc + parsed structure and open the editor.
  const loadModel = useCallback((text: string) => {
    const parsed = parseDoc(text, BASE_INDEX);
    setDocText(text);
    setOps(parsed.ops);
    setBase(parsed.base);
    setGsis(parsed.gsis);
    setStep(parsed.ops.length);
    setPinnedId(null);
    setMode("editor");
  }, []);

  // On open: if the URL carries a model (`#m=…`), load it.
  useEffect(() => {
    const shared = modelFromLocation(location.hash);
    if (shared) loadModel(shared);
  }, [loadModel]);

  const enterEditor = () => {
    // reflect current structure + data as text so the two stay one source
    setDocText(
      serializeTable(base) + serializeGsis(gsis) + "\n" + serializeOps(ops, base),
    );
    setMode("editor");
  };

  const edit: EditProps = {
    onEdit: (item, key, value) => {
      if ((item.attrs[key] ?? "") === value) return;
      commit(editToOps(item, key, value, base));
    },
    onDelete: (id) => commit([{ kind: "delete", id }]),
    onAddItem: (pkValue) => {
      const id = newId();
      const attrs: Record<string, string> = { [base.pk]: pkValue };
      if (base.sk) attrs[base.sk] = `ITEM#${id.slice(0, 4)}`;
      commit([{ kind: "put", item: { id, attrs } }]);
      setPinnedId(id);
    },
  };

  const reset = () => {
    setOps(SEED_OPS);
    setDocText(DEFAULT_DOC);
    setStep(SEED_OPS.length);
    setBase(parseDoc(DEFAULT_DOC, BASE_INDEX).base);
    setGsis(parseDoc(DEFAULT_DOC, BASE_INDEX).gsis);
    setPinnedId(null);
  };

  // The model as text, whichever mode we're in (canvas serializes ops back).
  const currentDoc = () =>
    editing
      ? docText
      : serializeTable(base) + serializeGsis(gsis) + "\n" + serializeOps(ops, base);

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

  const op = describe(ops[curStep - 1], base);
  const link: LinkProps = {
    hoveredId,
    pinnedId,
    onHover: setHoveredId,
    onPin: (id) => setPinnedId((cur) => (cur === id ? null : id)),
  };
  const dirty = ops !== SEED_OPS || docText !== DEFAULT_DOC;
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
              {m}
            </button>
          ))}
        </div>

        <div className="seg">
          {["base", ...gsis.map((g) => g.name), "split"].map((p) => (
            <button
              key={p}
              className={p === pane ? "active" : ""}
              onClick={() => setPane(p)}
            >
              {p}
            </button>
          ))}
        </div>

        <div className="seg">
          <button
            className={diffOn ? "active" : ""}
            onClick={() => setDiffOn((v) => !v)}
          >
            diff
          </button>
        </div>

        <button className="share" onClick={onShare} title="copy a shareable link to this model">
          share
        </button>
        {shareMsg && <span className="share-msg">{shareMsg}</span>}

        {dirty && (
          <button className="reset" onClick={reset}>
            reset
          </button>
        )}

        {pinnedId && (
          <button className="pin-chip" onClick={() => setPinnedId(null)}>
            <span className="dot" />
            pinned <code>{pinnedId.slice(0, 8)}</code>
            <span className="x">&times;</span>
          </button>
        )}

        <div className="spacer" />

        <div className="op-label">
          step {curStep}/{ops.length} &middot; <b>{op.verb}</b> {op.detail}
        </div>
        <div className="stepper">
          <button disabled={curStep === 0} onClick={() => setStep(curStep - 1)}>
            &minus;
          </button>
          <button
            disabled={curStep === ops.length}
            onClick={() => setStep(curStep + 1)}
          >
            +
          </button>
        </div>
      </div>

      {editing && (
        <div className="editor-wrap">
          <div className="editor-head">
            model script <span className="muted">— one line per step, edits apply live</span>
          </div>
          <Editor ref={editorRef} initialDoc={docText} onChange={onDoc} />
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

      <CostBar cost={cost} />

      {pane === "split" ? (
        <div className="split">
          <Panel
            view={baseView}
            prev={prevBaseView}
            diffOn={diffOn}
            link={link}
            edit={baseEdit}
            subtitle={editing ? "you write here · via script" : "you write here"}
          />
          {gsiViews.map((gv) => (
            <Panel
              key={gv.index.name}
              view={gv.view}
              prev={gv.prev}
              diffOn={diffOn}
              link={link}
              subtitle={`read-only · ${projLabel(gv.index)}`}
            />
          ))}
        </div>
      ) : pane === "base" ? (
        <Panel
          view={baseView}
          prev={prevBaseView}
          diffOn={diffOn}
          link={link}
          edit={baseEdit}
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
              subtitle={`read-only · ${projLabel(gv.index)}`}
            />
          ) : (
            <Panel view={baseView} prev={prevBaseView} diffOn={diffOn} link={link} />
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
    </div>
  );
}

const EFFECT_WORD: Record<string, string> = {
  none: "unchanged",
  insert: "insert",
  delete: "delete",
  update: "update",
  reindex: "reindex",
};

function CostBar({ cost }: { cost: OpCost | null }) {
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
}: {
  view: View;
  prev: View;
  diffOn: boolean;
  link: LinkProps;
  edit?: EditProps;
  subtitle?: string;
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
        {parts.length === 0 && (
          <div className="empty">no items under this index</div>
        )}
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
            <GridRows rows={part.rows} index={index} link={link} edit={edit} gutter={diffOn} />
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
}: {
  rows: DiffRow[];
  index: IndexSpec;
  link: LinkProps;
  edit?: EditProps;
  gutter: boolean;
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
          {edit && <th className="actions" />}
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => {
          const it: Item = r.item;
          const pinned = it.id === link.pinnedId ? " pinned" : "";
          const hovered = it.id === link.hoveredId ? " hovered" : "";
          const removed = r.status === "removed";
          return (
            <tr
              key={`${removed ? "x" : ""}${it.id}`}
              className={`row-${r.status}${pinned}${hovered}`}
              onMouseEnter={() => link.onHover(it.id)}
              onMouseLeave={() => link.onHover(null)}
              onClick={() => link.onPin(it.id)}
            >
              {gutter && <td className="gutter">{MARKER[r.status]}</td>}
              {cols.map((k) => {
                const val = it.attrs[k] ?? "";
                const key = isKeyAttr(k, index);
                if (edit && !removed) {
                  return (
                    <EditableCell key={k} value={val} isKey={key} onCommit={(v) => edit.onEdit(it, k, v)} />
                  );
                }
                const cls = key ? "iskey" : val ? "" : "blank";
                return (
                  <td className={cls} key={k}>
                    {val}
                  </td>
                );
              })}
              {edit && (
                <td className="actions">
                  {!removed && (
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
              )}
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
}: {
  value: string;
  isKey: boolean;
  onCommit: (v: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const cls = isKey ? "iskey editable" : value ? "editable" : "blank editable";

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
      title="double-click to edit"
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={() => setEditing(true)}
    >
      {value}
    </td>
  );
}
