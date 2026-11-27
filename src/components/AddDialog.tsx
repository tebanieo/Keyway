import { useState } from "react";
import { Modal } from "./CommandPalette";
import { entityLines, indexLine } from "../model/compose";
import type { IndexForm } from "../model/compose";
import { pkAttrs, skAttrs } from "../engine/engine";
import type { IndexSpec } from "../engine/types";

export type AddKind = "index" | "entity";

/**
 * Guided "Add": a new index or a new entity type, filled in as a form. It
 * writes ordinary script lines, previewed live as you type, so the form
 * teaches the syntax instead of hiding it; "Add to script" puts them in.
 */
export function AddDialog({
  open,
  kind,
  onKind,
  base,
  gsis,
  nextLabel,
  onAdd,
  onClose,
}: {
  open: boolean;
  kind: AddKind;
  onKind: (k: AddKind) => void;
  base: IndexSpec;
  gsis: IndexSpec[];
  /** A free item label for the first item of a new entity. */
  nextLabel: (type: string) => string;
  onAdd: (lines: string[]) => void;
  onClose: () => void;
}) {
  return (
    <Modal open={open} label="Add to the model" onClose={onClose} className="add-dialog">
      <AddBody
        kind={kind}
        onKind={onKind}
        base={base}
        gsis={gsis}
        nextLabel={nextLabel}
        onAdd={onAdd}
        onClose={onClose}
      />
    </Modal>
  );
}

// Mounted fresh on each open, so the fields start clean.
function AddBody({
  kind,
  onKind,
  base,
  gsis,
  nextLabel,
  onAdd,
  onClose,
}: Omit<Parameters<typeof AddDialog>[0], "open">) {
  const [ix, setIx] = useState<IndexForm>({
    name: `GSI${gsis.length + 1}`,
    pk: `GSI${gsis.length + 1}PK`,
    sk: `GSI${gsis.length + 1}SK`,
    projection: "all",
    include: "",
  });
  const keyAttrs = [...new Set([base, ...gsis].flatMap((i) => [...pkAttrs(i), ...skAttrs(i)]))];
  const [type, setType] = useState("");
  const [keys, setKeys] = useState<Record<string, string>>({});
  const [attrs, setAttrs] = useState("");

  const lines =
    kind === "index"
      ? [indexLine(ix)]
      : entityLines({ type, keys, attrs }, nextLabel(type.trim() || "entity"));
  const ready =
    kind === "index" ? ix.name.trim() !== "" && ix.pk.trim() !== "" : type.trim() !== "";

  return (
    <form
      className="palette-card add-card"
      onSubmit={(e) => {
        e.preventDefault();
        if (!ready) return;
        onAdd(lines);
        onClose();
      }}
    >
      <div className="shortcuts-head">
        <h2>Add to the model</h2>
        <button type="button" className="q-close" onClick={onClose} aria-label="Close">
          ×
        </button>
      </div>
      <div className="seg add-kind" role="group" aria-label="What to add">
        {(["index", "entity"] as AddKind[]).map((k) => (
          <button
            key={k}
            type="button"
            className={k === kind ? "active" : ""}
            aria-pressed={k === kind}
            onClick={() => onKind(k)}
          >
            {k === "index" ? "Index (GSI)" : "Entity type"}
          </button>
        ))}
      </div>

      {kind === "index" ? (
        <div className="add-fields">
          <label>
            Name
            <input
              autoFocus
              data-autofocus
              value={ix.name}
              onChange={(e) => setIx({ ...ix, name: e.target.value })}
            />
          </label>
          <label>
            Partition key attribute(s)
            <input value={ix.pk} onChange={(e) => setIx({ ...ix, pk: e.target.value })} />
            <small>up to 4, comma-separated, for a multi-key index</small>
          </label>
          <label>
            Sort key attribute(s)
            <input value={ix.sk} onChange={(e) => setIx({ ...ix, sk: e.target.value })} />
            <small>optional</small>
          </label>
          <label>
            Projection
            <select
              value={ix.projection}
              onChange={(e) =>
                setIx({ ...ix, projection: e.target.value as IndexForm["projection"] })
              }
            >
              <option value="all">All attributes</option>
              <option value="keys">Keys only</option>
              <option value="include">Keys plus some attributes…</option>
            </select>
          </label>
          {ix.projection === "include" && (
            <label>
              Attributes to include
              <input
                value={ix.include}
                onChange={(e) => setIx({ ...ix, include: e.target.value })}
                placeholder="status, total"
              />
            </label>
          )}
        </div>
      ) : (
        <div className="add-fields">
          <label>
            Type name
            <input
              autoFocus
              data-autofocus
              value={type}
              onChange={(e) => setType(e.target.value.replace(/\s+/g, "-"))}
              placeholder="order"
            />
            <small>items are tagged with it: _type={type || "order"}</small>
          </label>
          {keyAttrs.map((k) => (
            <label key={k}>
              {k}
              <input
                value={keys[k] ?? ""}
                onChange={(e) => setKeys({ ...keys, [k]: e.target.value })}
                placeholder={
                  k === base.pk ? "USER#{userId}" : k === base.sk ? "ORDER#{date}#{id}" : ""
                }
              />
            </label>
          ))}
          <small className="add-tip">
            Write <code>{"{name}"}</code> to build a key from the item&apos;s own attribute: one{" "}
            <code>@key</code> template fills every item of this type.
          </small>
          <label>
            Other attributes
            <input
              value={attrs}
              onChange={(e) => setAttrs(e.target.value)}
              placeholder="total, status"
            />
          </label>
        </div>
      )}

      <div className="add-preview">
        <span className="q-pname">Adds to the script</span>
        <pre aria-live="polite">{lines.join("\n")}</pre>
      </div>
      <div className="add-actions">
        <button type="submit" className="q-run" disabled={!ready}>
          Add to script
        </button>
      </div>
    </form>
  );
}
