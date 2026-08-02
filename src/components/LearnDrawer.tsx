import { Drawer } from "./Rail";
import { TOURS } from "../model/tours";
import type { Tour } from "../model/tours";

/** Guided tours as a rail drawer — each loads a curated model and auto-plays. */
export function LearnDrawer({
  open,
  onClose,
  onPlay,
}: {
  open: boolean;
  onClose: () => void;
  onPlay: (tour: Tour) => void;
}) {
  return (
    <Drawer open={open} title="Learn" onClose={onClose}>
      <div className="ex-list">
        {TOURS.map((tour) => (
          <button
            key={tour.name}
            className="ex-item"
            onClick={() => {
              onPlay(tour);
              onClose();
            }}
          >
            <span className="ex-title">{tour.name}</span>
            <span className="ex-desc">{tour.blurb}</span>
          </button>
        ))}
      </div>
    </Drawer>
  );
}
