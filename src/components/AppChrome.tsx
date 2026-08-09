// Small static chrome pieces around the app: the contextual hint line, the
// footer, and the transient "copied <value>" toast. Grouped here so App reads
// as a composition rather than carrying leaf markup.

export function AppHint({ editing }: { editing: boolean }) {
  return (
    <p className="hint">
      {editing ? (
        <>
          Type in the script above. <code>item</code>+Tab scaffolds a row. Add{" "}
          <code>@gsi GSI2 pk=GSI2PK sk=GSI2SK projection=keys</code> and a new pane appears. Each{" "}
          <code>@gsi</code> sets its own projection (<code>all</code>/<code>keys</code>
          /comma-list). Panes reparse live.
        </>
      ) : (
        <>
          Double-click a base cell to edit; click a row to pin and follow it. Switch to{" "}
          <b>editor</b> to author the same model as text.
        </>
      )}
    </p>
  );
}

export function AppFooter() {
  return (
    <footer className="app-footer">
      <span className="disclaimer">
        A personal project. Opinions are my own, not those of AWS or Amazon.{" "}
        <a href="https://github.com/tebanieo/Keyway" target="_blank" rel="noopener noreferrer">
          Source
        </a>
        .
      </span>
      <span className="copyright">© 2026 tebanieo</span>
    </footer>
  );
}

export function CopiedToast({ value }: { value: string | null }) {
  if (value === null) return null;
  return (
    <div className="copied-toast">
      copied <code>{value}</code>
    </div>
  );
}
