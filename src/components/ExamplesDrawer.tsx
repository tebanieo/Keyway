import { Drawer } from "./Rail";
import { EXAMPLES } from "../model/examples";
import { track } from "../analytics";

/** Examples gallery as a rail drawer: same load path a shared link uses. */
export function ExamplesDrawer({
  open,
  onClose,
  onLoad,
}: {
  open: boolean;
  onClose: () => void;
  onLoad: (dsl: string) => void;
}) {
  return (
    <Drawer open={open} title="Examples" onClose={onClose}>
      <div className="ex-list">
        {EXAMPLES.map((ex) => (
          <button
            key={ex.name}
            className="ex-item"
            onClick={() => {
              track("example-opened");
              onLoad(ex.dsl);
              onClose();
            }}
          >
            <span className="ex-title">{ex.name}</span>
            <span className="ex-desc">{ex.description}</span>
          </button>
        ))}
      </div>
    </Drawer>
  );
}
