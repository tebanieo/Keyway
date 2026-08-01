import { useMemo, useState } from "react";
import { pkAttrs, skAttrs } from "./engine/engine";
import { runQuery } from "./engine/query";
import type { Cond, CondOp } from "./engine/query";
import type { IndexSpec, Item } from "./engine/types";

const OPS: CondOp[] = ["=", "begins_with", "<", "<=", ">", ">=", "between"];

export interface QueryHighlight {
  matched: Set<string>; // returned items
  scanned: Set<string>; // items read (charged), incl. filtered-out
}

/**
 * A read against the current model: GetItem / Query / Scan. Reads the selected
 * index's key shape and enforces the query rules (equality on partition keys,
 * range only on the last sort key). Reports read cost and highlights results.
 *
 * NOTE: first-cut UX — functional, not yet styled to the "professional" bar.
 */
export function QueryPanel({
  base,
  gsis,
  state,
  onHighlight,
  onClose,
}: {
  base: IndexSpec;
  gsis: IndexSpec[];
  state: Map<string, Item>;
  onHighlight: (h: QueryHighlight) => void;
  onClose: () => void;
}) {
  const indexes = [base, ...gsis];
  const [op, setOp] = useState<"get" | "query" | "scan">("query");
  const [indexName, setIndexName] = useState(base.name);
  const index = indexes.find((i) => i.name === indexName) ?? base;
  const pks = pkAttrs(index);
  const sks = skAttrs(index);

  const [pkVals, setPkVals] = useState<Record<string, string>>({});
  const [skConds, setSkConds] = useState<Record<string, Cond>>({});
  const [filterOn, setFilterOn] = useState(false);
  const [filter, setFilter] = useState<{ attr: string; op: CondOp; value: string; value2?: string }>({
    attr: "",
    op: "=",
    value: "",
  });
  const [consistent, setConsistent] = useState(false);
  const [result, setResult] = useState<{ scanned: number; returned: number; rcu: number; error: string | null } | null>(null);

  // All attribute names in the model, for the filter dropdown.
  const attrNames = useMemo(() => {
    const s = new Set<string>();
    for (const it of state.values()) for (const k of Object.keys(it.attrs)) s.add(k);
    return [...s].sort();
  }, [state]);

  const setPk = (a: string, v: string) => setPkVals((p) => ({ ...p, [a]: v }));
  const setSk = (a: string, patch: Partial<Cond>) =>
    setSkConds((p) => {
      const cur: Cond = p[a] ?? { op: "=", value: "" };
      return { ...p, [a]: { ...cur, ...patch } };
    });

  const run = () => {
    // sort-key prefix: contiguous filled leading attributes
    const skParts: Cond[] = [];
    for (const a of sks) {
      const c = skConds[a];
      if (!c || c.value === "") break;
      skParts.push(c);
    }
    const common = {
      op,
      pk: pks.map((a) => pkVals[a] ?? ""),
      sk: sks.map((a) => skConds[a]?.value ?? ""),
      skParts,
      consistent,
    };
    const r = runQuery(state, index, { ...common, filter: filterOn && filter.attr ? filter : null });
    setResult({ scanned: r.scanned, returned: r.items.length, rcu: r.rcu, error: r.error });
    if (r.error) {
      onHighlight({ matched: new Set(), scanned: new Set() });
      return;
    }
    // the "read" set (before filter) drives the faint "you paid for this" highlight
    const read = runQuery(state, index, { ...common, filter: null });
    onHighlight({
      matched: new Set(r.items.map((i) => i.id)),
      scanned: new Set(read.items.map((i) => i.id)),
    });
  };

  const clear = () => {
    setResult(null);
    onHighlight({ matched: new Set(), scanned: new Set() });
  };

  return (
    <div className="query-panel">
      <div className="query-head">
        <span className="q-title">read</span>
        <div className="seg">
          {(["get", "query", "scan"] as const).map((o) => (
            <button key={o} className={o === op ? "active" : ""} onClick={() => setOp(o)}>
              {o}
            </button>
          ))}
        </div>
        <label className="q-field">
          index
          <select value={indexName} onChange={(e) => setIndexName(e.target.value)}>
            {indexes.map((i) => (
              <option key={i.name} value={i.name}>
                {i.name}
              </option>
            ))}
          </select>
        </label>
        <label className="q-check">
          <input type="checkbox" checked={consistent} onChange={(e) => setConsistent(e.target.checked)} />
          strong
        </label>
        <div className="spacer" />
        <button className="q-run" onClick={run}>
          run
        </button>
        <button className="q-clear" onClick={clear}>
          clear
        </button>
        <button className="q-close" onClick={onClose} title="close">
          &times;
        </button>
      </div>

      {op !== "scan" && (
        <div className="query-keys">
          {pks.map((a) => (
            <label key={a} className="q-field">
              <span className="q-key">{a}</span>
              <span className="q-eq">=</span>
              <input value={pkVals[a] ?? ""} placeholder="value" onChange={(e) => setPk(a, e.target.value)} />
            </label>
          ))}
          {op === "query" &&
            sks.map((a, i) => {
              const last = i === sks.length - 1;
              const c = skConds[a] ?? { op: "=", value: "" };
              return (
                <label key={a} className="q-field">
                  <span className="q-key">{a}</span>
                  {last ? (
                    <select value={c.op} onChange={(e) => setSk(a, { op: e.target.value as CondOp })}>
                      {OPS.map((o) => (
                        <option key={o} value={o}>
                          {o}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <span className="q-eq" title="leading sort keys must be equality">
                      =
                    </span>
                  )}
                  <input value={c.value} placeholder="value" onChange={(e) => setSk(a, { value: e.target.value })} />
                  {last && c.op === "between" && (
                    <input value={c.value2 ?? ""} placeholder="…and" onChange={(e) => setSk(a, { value2: e.target.value })} />
                  )}
                </label>
              );
            })}
          {op === "get" &&
            sks.map((a) => (
              <label key={a} className="q-field">
                <span className="q-key">{a}</span>
                <span className="q-eq">=</span>
                <input
                  value={skConds[a]?.value ?? ""}
                  placeholder="value"
                  onChange={(e) => setSk(a, { value: e.target.value })}
                />
              </label>
            ))}
        </div>
      )}

      <div className="query-filter">
        <label className="q-check">
          <input type="checkbox" checked={filterOn} onChange={(e) => setFilterOn(e.target.checked)} />
          filter
        </label>
        {filterOn && (
          <>
            <select value={filter.attr} onChange={(e) => setFilter((f) => ({ ...f, attr: e.target.value }))}>
              <option value="">attr…</option>
              {attrNames.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
            <select value={filter.op} onChange={(e) => setFilter((f) => ({ ...f, op: e.target.value as CondOp }))}>
              {OPS.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
            <input value={filter.value} placeholder="value" onChange={(e) => setFilter((f) => ({ ...f, value: e.target.value }))} />
            <span className="q-hint">applied after the read — trims results, not cost</span>
          </>
        )}
      </div>

      {result && (
        <div className={result.error ? "query-result err" : "query-result"}>
          {result.error ? (
            <span className="q-err">⚠ {result.error}</span>
          ) : (
            <>
              <span className="q-stat">
                <b>{result.scanned}</b> read
              </span>
              <span className="q-stat">
                <b>{result.returned}</b> returned
              </span>
              <span className="q-stat rcu">
                <b>{result.rcu}</b> RCU
              </span>
              {result.scanned > result.returned && (
                <span className="q-note">
                  you paid to read {result.scanned} but a filter kept {result.returned} — filters don't save RCU
                </span>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
