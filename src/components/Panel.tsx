/* eslint-disable react-refresh/only-export-components -- Panel co-locates its
   small pure helpers (projLabel, unionKeys, isKeyAttr) with the components that
   use them; the only cost is coarser HMR for this file, which is fine. */
import { useState } from "react";
import { pkAttrs, skAttrs } from "../engine/engine";
import { diffPartitions } from "../engine/diff";
import type { DiffRow } from "../engine/diff";
import type { IndexSpec, Item, View } from "../engine/types";
import type { QueryHighlight } from "../QueryPanel";

/** Hover/pin/copy wiring, shared by every row across every pane. */
export interface LinkProps {
  hoveredId: string | null;
  pinnedId: string | null;
  onHover: (id: string | null) => void;
  onPin: (id: string) => void;
  onCopy: (value: string) => void;
}

/** Grid-editing wiring — present only on the (canvas-mode) base pane. */
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
              <span>empty table - add an item, author in the editor, or load an example</span>
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
            <GridRows
              rows={part.rows}
              index={index}
              link={link}
              edit={edit}
              gutter={diffOn}
              query={query}
              focusId={focusId}
            />
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
