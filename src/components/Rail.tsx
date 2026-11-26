import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useDrawerFocus } from "../hooks/useDrawerFocus";

/** A right-side glass drawer shell (header + close). Content is passed in, so
 *  new rail sections just drop their body inside one of these. */
export function Drawer({
  open,
  title,
  head,
  onClose,
  initialFocus,
  children,
}: {
  open: boolean;
  title: string;
  head?: ReactNode;
  onClose: () => void;
  /** Selector for what to focus on open (default: the first control). */
  initialFocus?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useDrawerFocus(open, ref, onClose, initialFocus);
  return (
    // inert while closed: an off-screen drawer must not hold tab stops.
    <div
      ref={ref}
      className={open ? "drawer open" : "drawer"}
      role="dialog"
      aria-label={title}
      aria-hidden={!open}
      inert={!open}
    >
      <div className="drawer-head">
        <span className="drawer-title">{title}</span>
        {head}
        <div className="spacer" />
        <button className="q-close" onClick={onClose} title="close" aria-label={`Close ${title}`}>
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
  /** What the badge counts, for the accessible name ("1 unserved"). */
  badgeLabel?: string;
  /** Opens a drawer (so it exposes expanded/collapsed); false for links. */
  drawer?: boolean;
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
  // Which items had a badge, so the ✓ lands only where something was resolved.
  const [cleared, setCleared] = useState<Set<string>>(new Set());
  const badged = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (prev.current > 0 && total === 0) {
      setCleared(new Set(badged.current));
      setResolved(true);
      const t = window.setTimeout(() => setResolved(false), 1600);
      prev.current = total;
      return () => window.clearTimeout(t);
    }
    prev.current = total;
  }, [total]);
  useEffect(() => {
    badged.current = new Set(items.filter((i) => (i.badge ?? 0) > 0).map((i) => i.id));
  });

  if (items.length === 0) return null;
  const signal = total > 0 || resolved || reveal || items.some((i) => i.active);
  return (
    <nav
      aria-label="Tools"
      className={`rail${signal ? " revealed" : ""}${resolved ? " resolved" : ""}${reveal ? " hint" : ""}`}
    >
      {items.map((it) => {
        const badge = it.badge ?? 0;
        return (
          <button
            key={it.id}
            className={`rail-btn${it.active ? " active" : ""}${badge > 0 ? " warn" : ""}${resolved && cleared.has(it.id) ? " ok" : ""}`}
            onClick={it.onClick}
            title={it.label}
            aria-label={
              badge > 0 ? `${it.label}, ${badge} ${it.badgeLabel ?? ""}`.trim() : it.label
            }
            aria-expanded={it.drawer ? it.active : undefined}
          >
            {it.icon}
            {badge > 0 && <span className="rail-badge">{badge}</span>}
            {resolved && badge === 0 && cleared.has(it.id) && (
              <span className="rail-badge ok">✓</span>
            )}
            <span className="rail-label">{it.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
