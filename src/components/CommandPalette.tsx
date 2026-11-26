import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { matches } from "./commandMatch";
import type { Command } from "./commandMatch";

export type { Command };

/**
 * A native modal `<dialog>`: focus is trapped while open, Escape closes, and
 * focus returns to where it was. Shared by the palette and the cheatsheet.
 */
export function Modal({
  open,
  label,
  onClose,
  className,
  children,
}: {
  open: boolean;
  label: string;
  onClose: () => void;
  className: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      if (typeof d.showModal === "function") d.showModal();
      else d.setAttribute("open", "");
    } else if (!open && d.open) {
      if (typeof d.close === "function") d.close();
      else d.removeAttribute("open");
    }
  }, [open]);
  return (
    <dialog
      ref={ref}
      className={`kw-dialog ${className}`}
      aria-label={label}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      // A click on the backdrop (the dialog itself, outside the card) closes.
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {open && children}
    </dialog>
  );
}

/** Ctrl/Cmd+K: type to filter every action in the app, Enter to run it. */
export function CommandPalette({
  open,
  commands,
  onClose,
}: {
  open: boolean;
  commands: Command[];
  onClose: () => void;
}) {
  return (
    <Modal open={open} label="Command palette" onClose={onClose} className="palette">
      <PaletteBody commands={commands} onClose={onClose} />
    </Modal>
  );
}

// Mounted fresh on each open, so the query and selection start empty.
function PaletteBody({ commands, onClose }: { commands: Command[]; onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [sel, setSel] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);
  const shown = commands.filter((c) => matches(c, query));
  const active = Math.min(sel, Math.max(shown.length - 1, 0));

  useEffect(() => {
    listRef.current?.querySelector(`[data-i="${active}"]`)?.scrollIntoView?.({ block: "nearest" });
  }, [active]);

  const runAt = (i: number) => {
    const c = shown[i];
    if (!c) return;
    onClose();
    // After the dialog has closed and handed focus back.
    requestAnimationFrame(() => c.run());
  };

  return (
    <div className="palette-card">
      <input
        className="palette-input"
        autoFocus
        role="combobox"
        aria-expanded="true"
        aria-controls="palette-list"
        aria-activedescendant={shown.length ? `palette-${active}` : undefined}
        aria-label="Search commands"
        placeholder="Type a command…"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setSel(0);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setSel((active + 1) % Math.max(shown.length, 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setSel((active - 1 + shown.length) % Math.max(shown.length, 1));
          } else if (e.key === "Enter") {
            e.preventDefault();
            runAt(active);
          }
        }}
      />
      <ul id="palette-list" role="listbox" aria-label="Commands" ref={listRef}>
        {shown.map((c, i) => (
          <li
            key={c.id}
            id={`palette-${i}`}
            data-i={i}
            role="option"
            aria-selected={i === active}
            className={i === active ? "active" : ""}
            onMouseMove={() => setSel(i)}
            onClick={() => runAt(i)}
          >
            <span className="palette-label">{c.label}</span>
            {c.group && <span className="palette-group">{c.group}</span>}
            {c.keys && <kbd>{c.keys}</kbd>}
          </li>
        ))}
        {shown.length === 0 && <li className="palette-none">No matching command</li>}
      </ul>
    </div>
  );
}
