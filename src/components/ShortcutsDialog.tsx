import { Modal } from "./CommandPalette";

const MOD =
  typeof navigator !== "undefined" && /Mac|iP(hone|ad)/.test(navigator.platform) ? "⌘" : "Ctrl";

/** The `?` cheatsheet: every shortcut in one place, and the single-key off switch. */
export function ShortcutsDialog({
  open,
  keys,
  enabled,
  onToggle,
  onClose,
}: {
  open: boolean;
  keys: { key: string; label: string }[];
  enabled: boolean;
  onToggle: (on: boolean) => void;
  onClose: () => void;
}) {
  const always: [string, string][] = [
    [`${MOD} K`, "Command palette"],
    [
      `${MOD} Enter`,
      "Run the @ap under the caret (in the script) or the request (in the Query panel)",
    ],
    ["Tab", "Accept a suggestion, or jump to the next value (in the script)"],
    ["Esc, then Tab", "Leave the script"],
    ["F8", "Next problem in the script"],
  ];
  return (
    <Modal open={open} label="Keyboard shortcuts" onClose={onClose} className="shortcuts">
      <div className="palette-card shortcuts-card">
        <div className="shortcuts-head">
          <h2>Keyboard shortcuts</h2>
          <button className="q-close" onClick={onClose} aria-label="Close keyboard shortcuts">
            ×
          </button>
        </div>
        <dl className="shortcuts-list">
          {always.map(([k, l]) => (
            <div key={k}>
              <dt>
                <kbd>{k}</kbd>
              </dt>
              <dd>{l}</dd>
            </div>
          ))}
        </dl>
        <label className="shortcuts-toggle">
          <input type="checkbox" checked={enabled} onChange={(e) => onToggle(e.target.checked)} />
          Single-key shortcuts (when you're not typing)
        </label>
        <dl className={enabled ? "shortcuts-list" : "shortcuts-list off"}>
          {keys.map((s) => (
            <div key={s.key}>
              <dt>
                <kbd>{s.key}</kbd>
              </dt>
              <dd>{s.label}</dd>
            </div>
          ))}
        </dl>
      </div>
    </Modal>
  );
}
