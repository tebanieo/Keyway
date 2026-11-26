// The toolbar above the table panes: which panes are shown (plus an "All"
// toggle once there are GSIs), and the Diff / Compact display switches.
export function PanesBar({
  paneNames,
  visible,
  onTogglePane,
  showAll,
  allVisible,
  onToggleAll,
  diffOn,
  onToggleDiff,
  compact,
  onToggleCompact,
}: {
  paneNames: string[];
  visible: Set<string>;
  onTogglePane: (name: string) => void;
  showAll: boolean;
  allVisible: boolean;
  onToggleAll: () => void;
  diffOn: boolean;
  onToggleDiff: () => void;
  compact: boolean;
  onToggleCompact: () => void;
}) {
  return (
    <div className="panes-bar">
      <div
        className="seg"
        title="toggle which panes are shown"
        role="group"
        aria-label="Panes shown"
      >
        {paneNames.map((name) => (
          <button
            key={name}
            className={visible.has(name) ? "active" : ""}
            aria-pressed={visible.has(name)}
            onClick={() => onTogglePane(name)}
          >
            {name}
          </button>
        ))}
        {showAll && (
          <button
            className={allVisible ? "active" : ""}
            aria-pressed={allVisible}
            onClick={onToggleAll}
          >
            All
          </button>
        )}
      </div>
      <div className="seg" role="group" aria-label="View options">
        <button className={diffOn ? "active" : ""} aria-pressed={diffOn} onClick={onToggleDiff}>
          Diff
        </button>
        <button
          className={compact ? "active" : ""}
          aria-pressed={compact}
          onClick={onToggleCompact}
          title="tighten rows so larger models fit on screen"
        >
          Compact
        </button>
      </div>
    </div>
  );
}
