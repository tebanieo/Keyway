import { useEffect, useState } from "react";

// Which table panes are shown (multi-select), plus the diff/compact display
// toggles. Defaults to base + the last GSI, and reconciles as the model's index
// set changes so the selection never points at a pane that no longer exists.
export function usePaneVisibility(paneNames: string[]) {
  const [visible, setVisible] = useState<Set<string>>(
    () => new Set([paneNames[0], paneNames[paneNames.length - 1]].filter(Boolean)),
  );
  const [diffOn, setDiffOn] = useState(true);
  // Density toggle: tightens rows/padding so big models fit more on screen.
  const [compact, setCompact] = useState(false);

  // Reconcile the visible set when the index set changes (model load / @gsi
  // edit): drop panes that vanished; if nothing's left, default to base. Also
  // default to a SPLIT VIEW: if the model has a GSI but none is currently shown
  // (e.g. you just declared the first @gsi), reveal the last one so the
  // base+index panes appear without a manual click. Keyed on the names string
  // so it runs only on structural change — toggling panes off between edits
  // still sticks.
  const namesKey = paneNames.join("|");
  useEffect(() => {
    const names = namesKey.split("|");
    setVisible((prev) => {
      const kept = new Set([...prev].filter((n) => names.includes(n)));
      if (kept.size === 0) kept.add(names[0]);
      const gsiNames = names.slice(1);
      if (gsiNames.length > 0 && !gsiNames.some((n) => kept.has(n))) {
        kept.add(gsiNames[gsiNames.length - 1]);
      }
      return kept;
    });
  }, [namesKey]);

  const toggle = (name: string) =>
    setVisible((prev) => {
      const next = new Set(prev);
      if (next.has(name)) {
        if (next.size > 1) next.delete(name); // always keep at least one pane
      } else next.add(name);
      return next;
    });

  const allVisible = visible.size === paneNames.length;
  const toggleAll = () =>
    setVisible(
      allVisible
        ? new Set([paneNames[0], paneNames[paneNames.length - 1]].filter(Boolean))
        : new Set(paneNames),
    );

  return { visible, diffOn, setDiffOn, compact, setCompact, toggle, toggleAll, allVisible };
}
