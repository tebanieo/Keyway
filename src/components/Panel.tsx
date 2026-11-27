/* eslint-disable react-refresh/only-export-components -- Panel co-locates its
   small pure helpers (projLabel, unionKeys, isKeyAttr) with the components that
   use them; the only cost is coarser HMR for this file, which is fine. */
import { useEffect, useRef, useState } from "react";
import type { FocusEvent, KeyboardEvent } from "react";
import { pkAttrs, skAttrs } from "../engine/engine";
import { diffPartitions } from "../engine/diff";
import type { DiffRow } from "../engine/diff";
import type { IndexSpec, Item, View } from "../engine/types";

/** `1 item`, `3 items`. */
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
import type { QueryHighlight } from "./QueryPanel";

/** Hover/pin/copy wiring, shared by every row across every pane. */
export interface LinkProps {
  hoveredId: string | null;
  pinnedId: string | null;
  onHover: (id: string | null) => void;
  onPin: (id: string) => void;
  onCopy: (value: string) => void;
}

/** Grid-editing wiring: present only on the (canvas-mode) base pane. */
export interface EditProps {
  onEdit: (item: Item, key: string, value: string) => void;
  onDelete: (id: string) => void;
  onAddItem: (pkValue: string) => void;
}

/** Short label for an index's projection, shown in the pane subtitle. */
export function projLabel(index: IndexSpec): string {
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
/** The diff mark, as words for screen readers. */
const MARKER_TEXT: Record<string, string> = {
  added: "added",
  removed: "removed",
  modified: "modified",
  same: "",
};

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

// Fixed parts of a row: cell padding (both sides), the diff gutter, the
// pin/delete column. Must match .ptable td / th.gutter / th.actions.
const CELL_PAD = 28;
const GUTTER_W = 20;
const ACTIONS_W = 52;
/** Longest value shown (in ch) before an ellipsis; matches .ptable td. */
const MAX_CH = 36;

/** A column's width in ch: its widest value (capped), or its header. The
 *  header is set smaller in a proportional face, so it needs fewer ch. */
function columnWidth(k: string, rows: DiffRow[]): number {
  let w = Math.ceil(k.length * 0.8);
  for (const r of rows) w = Math.max(w, (r.item.attrs[k] ?? "").length);
  return Math.min(Math.max(w, 2), MAX_CH);
}

/** One index pane: title + a partition card per partition key. */
export function Panel({
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
  // One column set and one set of widths for the whole pane, so every
  // partition's columns line up under each other and can be compared down
  // the page (an attribute an item lacks shows as a blank cell).
  const allRows = parts.flatMap((p) => p.rows);
  const cols = unionKeys(allRows, index);
  const widths = cols.map((k) => columnWidth(k, allRows));

  return (
    <div className="panel">
      <div className="panel-title" role="heading" aria-level={2}>
        <span className="idx">{index.name}</span>
        {subtitle && <span className="sub">{subtitle}</span>}
        <span className="count">{plural(total, "item")}</span>
      </div>
      <div className="partitions">
        {parts.length === 0 &&
          (edit ? (
            <div className="empty">
              <span>nothing written yet: type in the script, press Play, or</span>
              <button className="add-item" onClick={() => edit.onAddItem("ITEM#1")}>
                + add an item
              </button>
            </div>
          ) : (
            <div className="empty">no items in this index yet</div>
          ))}
        {parts.map((part) => (
          <div className="partition" key={`${index.name}:${part.pk}`}>
            <div className="partition-head">
              <span className="pk">{part.pk}</span>
              <span className="count">
                {plural(part.rows.filter((r) => r.status !== "removed").length, "item")}
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
            <GridRows
              label={`${index.name}, partition ${part.pk}`}
              rows={part.rows}
              index={index}
              link={link}
              edit={edit}
              gutter={diffOn}
              query={query}
              focusId={focusId}
              cols={cols}
              widths={widths}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

function GridRows({
  label,
  rows,
  index,
  link,
  edit,
  gutter,
  query,
  focusId,
  cols,
  widths,
}: {
  /** The pane's columns and their widths (in ch), shared by its partitions. */
  cols: string[];
  widths: number[];
  /** Names the table for assistive tech: the index and the partition. */
  label: string;
  rows: DiffRow[];
  index: IndexSpec;
  link: LinkProps;
  edit?: EditProps;
  gutter: boolean;
  query?: QueryHighlight;
  focusId?: string | null;
}) {
  // The last key column (the sort key, else the partition key) stays put
  // while a wide item scrolls sideways, so each row keeps its name.
  const lead = cols.filter((k) => isKeyAttr(k, index));
  const stick = lead[lead.length - 1];
  const stickCls = (k: string) => (k === stick ? " stick" : "");
  const queried = !!query && query.scanned.size > 0 && (!query.index || query.index === index.name);
  // In a grid every cell is a gridcell; the ones you can't type into say so.
  const readOnly = edit ? { role: "gridcell", "aria-readonly": true } : {};
  return (
    <div className="ptable-scroll">
      <table
        className="ptable"
        aria-label={label}
        // Editable (Canvas): an ARIA grid, so arrow keys reach it in screen
        // readers and every cell says whether it can be edited.
        role={edit ? "grid" : undefined}
        aria-describedby={edit ? "grid-keys-help" : undefined}
        onKeyDown={edit ? moveInGrid : undefined}
        onFocus={edit ? rove : undefined}
        style={{
          width: `calc(${widths.reduce((a, b) => a + b, 0)}ch + ${cols.length * CELL_PAD + (gutter ? GUTTER_W : 0) + ACTIONS_W}px)`,
        }}
      >
        <colgroup>
          {gutter && <col style={{ width: GUTTER_W }} />}
          {cols.map((k, i) => (
            <col key={k} style={{ width: `calc(${widths[i]}ch + ${CELL_PAD}px)` }} />
          ))}
          <col style={{ width: ACTIONS_W }} />
        </colgroup>
        <thead>
          <tr>
            {gutter && (
              <th className="gutter">
                <span className="sr-only">Change</span>
              </th>
            )}
            {cols.map((k) => (
              <th className={(isKeyAttr(k, index) ? "iskey" : "") + stickCls(k)} key={k}>
                {k}
              </th>
            ))}
            <th className="actions">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const it: Item = r.item;
            const pinned = it.id === link.pinnedId ? " pinned" : "";
            const hovered = it.id === link.hoveredId ? " hovered" : "";
            // A read's result, on the index it ran on: returned, read but
            // filtered out (paid for, never returned), or not read at all.
            const q = !queried
              ? ""
              : query!.matched.has(it.id)
                ? " q-matched"
                : query!.scanned.has(it.id)
                  ? " q-read"
                  : " q-skip";
            const dim = focusId && it.id !== focusId ? " dimmed" : "";
            const removed = r.status === "removed";
            return (
              <tr
                key={`${removed ? "x" : ""}${it.id}`}
                className={`row-${r.status}${pinned}${hovered}${q}${dim}`}
                data-item={it.id}
                onMouseEnter={() => link.onHover(it.id)}
                onMouseLeave={() => link.onHover(null)}
              >
                {gutter && (
                  <td className="gutter" {...readOnly}>
                    <span aria-hidden="true">{MARKER[r.status]}</span>
                    <span className="sr-only">{MARKER_TEXT[r.status]}</span>
                  </td>
                )}
                {cols.map((k) => {
                  const val = it.attrs[k] ?? "";
                  const key = isKeyAttr(k, index);
                  if (edit && !removed) {
                    return (
                      <EditableCell
                        key={k}
                        value={val}
                        isKey={key}
                        extra={stickCls(k)}
                        first={r === rows[0] && k === cols[0]}
                        itemId={it.id}
                        col={k}
                        onCommit={(v) => edit.onEdit(it, k, v)}
                        onCopy={link.onCopy}
                      />
                    );
                  }
                  const cls =
                    (key ? "iskey" : val ? "" : "blank") + (val ? " copyable" : "") + stickCls(k);
                  return (
                    <td
                      {...readOnly}
                      className={cls}
                      key={k}
                      title={val ? `${val.length > 36 ? `${val}\n` : ""}click to copy` : undefined}
                      onClick={() => val && link.onCopy(val)}
                    >
                      {val}
                    </td>
                  );
                })}
                <td className="actions" {...readOnly}>
                  {queried && (q === " q-matched" || q === " q-read") && (
                    <span className="sr-only">
                      {q === " q-matched" ? "returned by the read" : "read, filtered out"}
                    </span>
                  )}
                  <button
                    className={link.pinnedId === it.id ? "pin-btn on" : "pin-btn"}
                    title="pin / follow this item"
                    aria-label={`${link.pinnedId === it.id ? "Unpin" : "Pin"} ${it.id}`}
                    aria-pressed={link.pinnedId === it.id}
                    onClick={(e) => {
                      e.stopPropagation();
                      link.onPin(it.id);
                    }}
                  />
                  {edit && !removed && (
                    <button
                      className="del-btn"
                      title="delete item"
                      aria-label={`Delete ${it.id}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        const pane = e.currentTarget.closest(".panel");
                        edit.onDelete(it.id);
                        // The button goes with the row: keep the keyboard in the pane.
                        afterRender(() => pane?.querySelector<HTMLElement>(CELL));
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
    </div>
  );
}

/** After React re-renders: if focus fell to the page, put it on `target()`. */
function afterRender(target: () => HTMLElement | null | undefined) {
  requestAnimationFrame(() => {
    if (document.activeElement && document.activeElement !== document.body) return;
    target()?.focus();
  });
}

// Keyboard grid for editable (Canvas) tables: one tab stop per table, the
// arrow keys move between cells, Enter or F2 edits, Escape cancels.
const CELL = "td[data-cell]";

/** Only the focused cell is in the tab order, so Tab leaves the table. */
function rove(e: FocusEvent<HTMLTableElement>) {
  const cell = (e.target as Element).closest?.(CELL) as HTMLElement | null;
  if (!cell) return;
  e.currentTarget.querySelectorAll<HTMLElement>(CELL).forEach((c) => (c.tabIndex = -1));
  cell.tabIndex = 0;
}

function moveInGrid(e: KeyboardEvent<HTMLTableElement>) {
  const cell = (e.target as Element).closest?.(CELL) as HTMLTableCellElement | null;
  if (!cell || e.target !== cell) return; // not while typing in a cell
  const row = cell.parentElement as HTMLTableRowElement;
  const rows = [...e.currentTarget.tBodies[0].rows];
  const r = rows.indexOf(row);
  const c = cell.cellIndex;
  const at = (ri: number, ci: number) => {
    const target = rows[ri]?.cells[ci];
    return target?.matches(CELL) ? (target as HTMLElement) : null;
  };
  // Up/down skip rows with nothing to edit (a removed row in the diff).
  const vertical = (dir: 1 | -1) => {
    for (let ri = r + dir; ri >= 0 && ri < rows.length; ri += dir) {
      if (rows[ri].querySelector(CELL)) return at(ri, c);
    }
    return null;
  };
  const cells = [...row.querySelectorAll<HTMLElement>(CELL)];
  const next: Record<string, () => HTMLElement | null> = {
    ArrowUp: () => vertical(-1),
    ArrowDown: () => vertical(1),
    ArrowLeft: () => at(r, c - 1),
    ArrowRight: () => at(r, c + 1),
    Home: () => cells[0] ?? null,
    End: () => cells[cells.length - 1] ?? null,
  };
  const go = next[e.key];
  if (!go) return;
  e.preventDefault();
  go()?.focus();
}

function EditableCell({
  value,
  isKey,
  extra = "",
  first = false,
  itemId,
  col,
  onCommit,
  onCopy,
}: {
  value: string;
  isKey: boolean;
  extra?: string;
  /** The table's first cell: its tab stop until another cell takes focus. */
  first?: boolean;
  itemId?: string;
  col?: string;
  onCommit: (v: string) => void;
  onCopy: (v: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const cell = useRef<HTMLTableCellElement>(null);
  // Back from editing by keyboard: the cell takes focus again.
  const refocus = useRef(false);
  useEffect(() => {
    if (!editing && refocus.current) {
      refocus.current = false;
      cell.current?.focus();
    }
  }, [editing]);
  const base = isKey ? "iskey editable" : value ? "editable" : "blank editable";
  const cls = (value ? `${base} copyable` : base) + extra;

  if (editing) {
    return (
      <td className={(isKey ? "iskey" : "") + extra} ref={cell} role="gridcell">
        <input
          className="cell-input"
          aria-label={col && itemId ? `${col} of ${itemId}` : "Cell value"}
          autoFocus
          defaultValue={value}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              refocus.current = true;
              onCommit(e.currentTarget.value);
              setEditing(false);
              // A key edit moves the row (another partition): follow it there.
              if (itemId && col) {
                afterRender(() =>
                  document.querySelector<HTMLElement>(
                    `.wb-tables tr[data-item="${CSS.escape(itemId)}"] td[data-col="${CSS.escape(col)}"]`,
                  ),
                );
              }
            } else if (e.key === "Escape") {
              e.stopPropagation();
              refocus.current = true;
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
      ref={cell}
      className={cls}
      data-cell=""
      role="gridcell"
      data-col={col}
      tabIndex={first ? 0 : -1}
      title={
        value
          ? `${value.length > 36 ? `${value}\n` : ""}click to copy · double-click or Enter to edit`
          : "double-click or Enter to edit"
      }
      onClick={() => value && onCopy(value)}
      onDoubleClick={() => setEditing(true)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === "F2") {
          e.preventDefault();
          setEditing(true);
        }
      }}
    >
      {value}
    </td>
  );
}
