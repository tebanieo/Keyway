import { useState } from "react";
import type { LinkProps } from "../components/Panel";

// Row-interaction state shared across every pane: which item is hovered, which
// is pinned (click a row to follow it across steps), and a transient
// "copied <value>" toast. `link` bundles these into the props each Panel needs,
// so the panes stay decoupled from where the state lives.
export function useSelection() {
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [pinnedId, setPinnedId] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const link: LinkProps = {
    hoveredId,
    pinnedId,
    onHover: setHoveredId,
    onPin: (id) => setPinnedId((cur) => (cur === id ? null : id)),
    onCopy: (value) => {
      if (value === "") return;
      void navigator.clipboard?.writeText(value);
      setCopied(value);
      window.setTimeout(() => setCopied((c) => (c === value ? null : c)), 1400);
    },
  };

  return { link, hoveredId, pinnedId, setPinnedId, copied };
}
