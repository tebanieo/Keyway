import { Icon, Logo } from "./icons";
import type { Theme } from "../hooks/useTheme";

/**
 * The top command bar: brand, theme/share/reset and the pinned chip. Purely presentational; all behavior is passed in.
 */
export function Toolbar({
  theme,
  onToggleTheme,
  onShare,
  dirty,
  onReset,
  pinnedId,
  onUnpin,
}: {
  theme: Theme;
  onToggleTheme: () => void;
  onShare: () => void;
  dirty: boolean;
  onReset: () => void;
  pinnedId: string | null;
  onUnpin: () => void;
}) {
  return (
    <header className="toolbar">
      <h1>
        <Logo />
        <span className="brand-name">Keyway</span>
      </h1>

      <button
        className="icon-btn"
        onClick={onToggleTheme}
        title={theme === "paper" ? "Switch to dark theme" : "Switch to light theme"}
        aria-label={theme === "paper" ? "Switch to dark theme" : "Switch to light theme"}
      >
        <Icon name="theme" />
      </button>

      <button className="share" onClick={onShare} title="share this model as a link or QR code">
        Share
      </button>

      {dirty && (
        <button className="reset" onClick={onReset}>
          Reset
        </button>
      )}

      {pinnedId && (
        <button className="pin-chip" onClick={onUnpin} aria-label={`Unpin ${pinnedId}`}>
          <span className="dot" />
          Pinned <code>{pinnedId.slice(0, 8)}</code>
          <span className="x">&times;</span>
        </button>
      )}
    </header>
  );
}
