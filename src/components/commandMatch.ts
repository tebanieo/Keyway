export interface Command {
  id: string;
  label: string;
  /** A group shown on the right (e.g. "Example", "Panel"). */
  group?: string;
  /** The single-key shortcut, shown as a hint. */
  keys?: string;
  run: () => void;
}

/** Every word of the query appears in the label (or group), in any order. */
export function matches(c: Command, query: string): boolean {
  const hay = `${c.label} ${c.group ?? ""}`.toLowerCase();
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((w) => hay.includes(w));
}
