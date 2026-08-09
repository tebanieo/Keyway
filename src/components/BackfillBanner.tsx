import type { Backfill } from "../model/backfill";

// The schema-drift prompt: an attribute is on some items of an entity but not
// all. Offers to backfill it onto the ones missing it, or dismiss the nudge.
export function BackfillBanner({
  backfill,
  onApply,
  onDismiss,
}: {
  backfill: Backfill;
  onApply: () => void;
  onDismiss: () => void;
}) {
  return (
    <div className="backfill">
      <span className="msg">
        <code>{backfill.attr}</code> is on some <b>{backfill.type}</b> items but not all. Add it to
        the {backfill.targets.length} without it?
      </span>
      <button className="do" onClick={onApply}>
        backfill {backfill.targets.length}
      </button>
      <button className="ghost" onClick={onDismiss}>
        dismiss
      </button>
    </div>
  );
}
