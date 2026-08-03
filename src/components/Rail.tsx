import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

/** A right-side glass drawer shell (header + close). Content is passed in, so
 *  new rail sections just drop their body inside one of these. */
export function Drawer({
  open,
  title,
  head,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  head?: ReactNode;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <div className={open ? "drawer open" : "drawer"} aria-hidden={!open}>
      <div className="drawer-head">
        <span className="drawer-title">{title}</span>
        {head}
        <div className="spacer" />
        <button className="q-close" onClick={onClose} title="close">
          &times;
        </button>
      </div>
      {children}
    </div>
  );
}

/** One entry in the right activity rail. */
export interface RailItem {
  id: string;
  label: string;
  icon: ReactNode;
  /** A count worth reacting to (e.g. uncovered patterns) → badge + attention. */
  badge?: number;
  active: boolean;
  onClick: () => void;
}

/**
 * A right-edge activity rail: the launcher for the side drawers. It tucks to a
 * slim pull-tab when nothing needs attention (hover to reveal), and auto-reveals
 * with a badge + pulse when an item has something to react to (an uncovered
 * access pattern today; query / warnings / helpers later).
 */
export function RightRail({ items, reveal }: { items: RailItem[]; reveal?: boolean }) {
  const total = items.reduce((n, i) => n + (i.badge ?? 0), 0);
  // When the last badge clears (>0 → 0), flash a green "resolved" ✓ and keep the
  // rail out for a beat before it floats back to its tab: a reward for fixing it.
  const [resolved, setResolved] = useState(false);
  const prev = useRef(total);
  useEffect(() => {
    if (prev.current > 0 && total === 0) {
      setResolved(true);
      const t = window.setTimeout(() => setResolved(false), 1600);
      prev.current = total;
      return () => window.clearTimeout(t);
    }
    prev.current = total;
  }, [total]);

  if (items.length === 0) return null;
  const signal = total > 0 || resolved || reveal || items.some((i) => i.active);
  return (
    <div
      className={`rail${signal ? " revealed" : ""}${resolved ? " resolved" : ""}${reveal ? " hint" : ""}`}
    >
      {items.map((it) => {
        const badge = it.badge ?? 0;
        return (
          <button
            key={it.id}
            className={`rail-btn${it.active ? " active" : ""}${badge > 0 ? " warn" : ""}${resolved ? " ok" : ""}`}
            onClick={it.onClick}
            title={it.label}
            aria-label={it.label}
          >
            {it.icon}
            {badge > 0 && <span className="rail-badge">{badge}</span>}
            {resolved && badge === 0 && <span className="rail-badge ok">✓</span>}
            <span className="rail-label">{it.label}</span>
          </button>
        );
      })}
    </div>
  );
}
