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
      <div className="chips" role="group" aria-label="Panes shown">
        {paneNames.map((name) => (
          <button
            key={name}
            className="chip"
            aria-pressed={visible.has(name)}
            onClick={() => onTogglePane(name)}
          >
            {name}
          </button>
        ))}
        {showAll && !allVisible && (
          <button className="chip-link" onClick={onToggleAll}>
            Show all
          </button>
        )}
      </div>
      <div className="chips" role="group" aria-label="View options">
        <button className="chip" aria-pressed={diffOn} onClick={onToggleDiff}>
          Diff
        </button>
        <button
          className="chip"
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
