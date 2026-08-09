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
      <div className="seg" title="toggle which panes are shown">
        {paneNames.map((name) => (
          <button
            key={name}
            className={visible.has(name) ? "active" : ""}
            onClick={() => onTogglePane(name)}
          >
            {name}
          </button>
        ))}
        {showAll && (
          <button className={allVisible ? "active" : ""} onClick={onToggleAll}>
            All
          </button>
        )}
      </div>
      <div className="seg">
        <button className={diffOn ? "active" : ""} onClick={onToggleDiff}>
          Diff
        </button>
        <button
          className={compact ? "active" : ""}
          onClick={onToggleCompact}
          title="tighten rows so larger models fit on screen"
        >
          Compact
        </button>
      </div>
    </div>
  );
}
