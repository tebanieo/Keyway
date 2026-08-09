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
  curStep,
  opsLength,
  op,
  playing,
  onTogglePlay,
  onPrev,
  onNext,
  speed,
  onSpeed,
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
  curStep: number;
  opsLength: number;
  op: { verb: string; detail: string };
  playing: boolean;
  onTogglePlay: () => void;
  onPrev: () => void;
  onNext: () => void;
  speed: number;
  onSpeed: (n: number) => void;
}) {
  return (
    <div className="toolbar">
      <h1>
        <Logo />
        Keyway
      </h1>

      <div className="seg">
        {(["canvas", "editor"] as Mode[]).map((m) => (
          <button key={m} className={m === mode ? "active" : ""} onClick={() => onMode(m)}>
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
        <button className="pin-chip" onClick={onUnpin}>
          <span className="dot" />
          Pinned <code>{pinnedId.slice(0, 8)}</code>
          <span className="x">&times;</span>
        </button>
      )}

      <div className="spacer" />

      <div className="op-label">
        step {curStep}/{opsLength} &middot; <b>{op.verb}</b> {op.detail}
      </div>
      <div className="stepper">
        <button disabled={curStep === 0} onClick={onPrev} title="step back">
          <Icon name="prev" />
        </button>
        <button className="play" onClick={onTogglePlay} title="auto-play">
          <Icon name={playing ? "pause" : "play"} />
        </button>
        <button disabled={curStep === opsLength} onClick={onNext} title="step forward">
          <Icon name="next" />
        </button>
        <button
          className="speed"
          onClick={() => onSpeed(speed === 0.5 ? 1 : speed === 1 ? 2 : 0.5)}
          title="playback speed (click to cycle)"
          aria-label="playback speed"
        >
          {speed}&times;
        </button>
      </div>
    </div>
  );
}
