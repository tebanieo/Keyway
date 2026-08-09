import { useEffect, useState } from "react";
import type { QueryHighlight } from "../components/QueryPanel";

export type DrawerName = "patterns" | "examples" | "query" | "learn";

const NO_HIGHLIGHT: QueryHighlight = { matched: new Set(), scanned: new Set() };

// The right-rail drawers: only one opens at a time (they share the edge), plus
// the query highlight that's only meaningful while the Query drawer is open.
// `modelEmpty` lets the Query drawer auto-close when the model empties out
// (e.g. a reset while it's open).
export function useDrawers(modelEmpty: boolean) {
  const [drawer, setDrawer] = useState<DrawerName | null>(null);
  const [highlight, setHighlight] = useState<QueryHighlight>(NO_HIGHLIGHT);

  // Open a drawer, or close it if it's already the open one.
  const toggle = (name: DrawerName) => setDrawer((d) => (d === name ? null : name));
  const close = () => setDrawer(null);

  // Teal query highlights (matched/scanned rows) only make sense while the
  // Query drawer is open; drop them whenever it isn't.
  useEffect(() => {
    if (drawer !== "query") setHighlight(NO_HIGHLIGHT);
  }, [drawer]);

  // Click anywhere outside the rail/drawer dismisses the open drawer.
  useEffect(() => {
    if (!drawer) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Element | null;
      if (t && !t.closest(".rail") && !t.closest(".drawer")) setDrawer(null);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [drawer]);

  // Close the Query drawer if the model empties out while it's open.
  useEffect(() => {
    if (modelEmpty && drawer === "query") setDrawer(null);
  }, [modelEmpty, drawer]);

  return { drawer, setDrawer, toggle, close, highlight, setHighlight };
}
