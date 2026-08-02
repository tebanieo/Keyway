import type { OpCost } from "../engine/cost";

const EFFECT_WORD: Record<string, string> = {
  none: "unchanged",
  insert: "insert",
  delete: "delete",
  update: "update",
  reindex: "reindex",
};

/** The write-cost readout for the current step: base + per-index effect/WCU. */
export function CostBar({ cost, bytes }: { cost: OpCost | null; bytes: number }) {
  if (!cost) {
    return (
      <div className="costbar">
        <span className="idle">empty table · step forward or add an item</span>
      </div>
    );
  }
  return (
    <div className="costbar">
      <span className="total">
        <b>{cost.totalWrites}</b>
        <span className="unit">WCU</span>
      </span>
      {bytes > 0 && (
        <span className="item-bytes">
          item <b>{bytes}</b> b
        </span>
      )}
      <span className={cost.transactional ? "seg-cost eff-box eff-tx" : "seg-cost"}>
        <span className="idx">base</span>
        <span className="eff eff-write">{cost.base}</span>
        {cost.transactional && <span className="tx-badge">TX &times;2</span>}
        <span className="w">{cost.baseWrites}</span>
      </span>
      {cost.indexes.map((i) => (
        <span className={`seg-cost eff-box eff-${i.effect}`} key={i.index}>
          <span className="idx">{i.index}</span>
          <span className={`eff eff-${i.effect}`}>{EFFECT_WORD[i.effect]}</span>
          {i.from && i.to ? (
            <span className="move">
              <code>{i.from}</code>
              <span className="arrow">&rarr;</span>
              <code>{i.to}</code>
            </span>
          ) : i.to ? (
            <code>{i.to}</code>
          ) : i.from ? (
            <code>{i.from}</code>
          ) : null}
          <span className="w">{i.writes}</span>
        </span>
      ))}
    </div>
  );
}
