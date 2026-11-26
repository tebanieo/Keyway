import { Icon, Logo } from "./icons";
import type { Theme } from "../hooks/useTheme";

export type Mode = "canvas" | "editor";

/** Title-case a single-word action label (identifiers are shown verbatim). */
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * The top command bar: brand, mode toggle, theme/share/reset, the pinned chip,
 * and the step transport. Purely presentational; all behavior is passed in.
 */
export function Toolbar({
  mode,
  onMode,
  theme,
  onToggleTheme,
  onShare,
  dirty,
  onReset,
  pinnedId,
  onUnpin,
}: {
  mode: Mode;
  onMode: (m: Mode) => void;
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

      <div className="seg" role="group" aria-label="View">
        {(["canvas", "editor"] as Mode[]).map((m) => (
          <button
            key={m}
            className={m === mode ? "active" : ""}
            aria-pressed={m === mode}
            onClick={() => onMode(m)}
          >
            {cap(m)}
          </button>
        ))}
      </div>

      <button
        className="icon-btn"
        onClick={onToggleTheme}
        title={theme === "paper" ? "switch to dark" : "switch to paper"}
        aria-label="toggle theme"
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
