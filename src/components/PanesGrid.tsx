import { Panel } from "./Panel";
import type { EditProps, LinkProps } from "./Panel";
import type { View } from "../engine/types";
import type { QueryHighlight } from "./QueryPanel";

// One rendered pane: a projected index view plus its previous view (for diffs),
// an optional editing surface, and a subtitle. App builds these from the base
// table and each visible GSI.
export interface ShownPane {
  name: string;
  view: View;
  prev: View;
  edit?: EditProps;
  subtitle: string;
}

// The grid of visible table panes (base + GSIs). Purely presentational: it
// lays out the panes and threads the shared interaction props to each.
export function PanesGrid({
  panes,
  compact,
  diffOn,
  link,
  query,
  focusId,
}: {
  panes: ShownPane[];
  compact: boolean;
  diffOn: boolean;
  link: LinkProps;
  query?: QueryHighlight;
  focusId?: string | null;
}) {
  return (
    <div className={compact ? "panes compact" : "panes"}>
      {panes.map((p) => (
        <Panel
          key={p.name}
          view={p.view}
          prev={p.prev}
          diffOn={diffOn}
          link={link}
          edit={p.edit}
          query={query}
          focusId={focusId}
          subtitle={p.subtitle}
        />
      ))}
    </div>
  );
}
