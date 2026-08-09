import { Icon } from "./icons";
import { RightRail } from "./Rail";
import type { DrawerName } from "../hooks/useDrawers";

// The right-edge navigation rail. Builds the drawer buttons (Examples, Learn,
// and — only when there's something to act on — Query and Access Patterns),
// plus a Docs link that opens the VitePress site in a new tab.
export function AppRail({
  reveal,
  drawer,
  onToggle,
  hasData,
  apCount,
  apUnserved,
}: {
  reveal: boolean;
  drawer: DrawerName | null;
  onToggle: (name: DrawerName) => void;
  hasData: boolean;
  apCount: number;
  apUnserved: number;
}) {
  return (
    <RightRail
      reveal={reveal}
      items={[
        {
          id: "examples",
          label: "Examples",
          icon: <Icon name="examples" />,
          active: drawer === "examples",
          onClick: () => onToggle("examples"),
        },
        {
          id: "learn",
          label: "Learn",
          icon: <Icon name="learn" />,
          active: drawer === "learn",
          onClick: () => onToggle("learn"),
        },
        // Query only appears once there's data: you can't query an empty table.
        ...(hasData
          ? [
              {
                id: "query",
                label: "Read / Query",
                icon: <Icon name="query" />,
                active: drawer === "query",
                onClick: () => onToggle("query"),
              },
            ]
          : []),
        ...(apCount > 0
          ? [
              {
                id: "patterns",
                label: "Access Patterns",
                icon: <Icon name="patterns" />,
                badge: apUnserved,
                active: drawer === "patterns",
                onClick: () => onToggle("patterns"),
              },
            ]
          : []),
        // Docs opens the VitePress site in a new tab, so it never owns a drawer.
        {
          id: "docs",
          label: "Docs",
          icon: <Icon name="docs" />,
          active: false,
          onClick: () => window.open(`${import.meta.env.BASE_URL}docs/`, "_blank", "noopener"),
        },
      ]}
    />
  );
}
