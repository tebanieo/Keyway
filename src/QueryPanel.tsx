import { useState } from "react";
import { pkAttrs, skAttrs } from "./engine/engine";
import { runQuery } from "./engine/query";
import type { Cond, CondOp } from "./engine/query";
import { parseFilter } from "./engine/filter";
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
  open,
  base,
  gsis,
  state,
  onHighlight,
  onClose,
}: {
  open: boolean;
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
  const isBase = index.name === base.name;
  const pks = pkAttrs(index);
  const sks = skAttrs(index);

  const [pkVals, setPkVals] = useState<Record<string, string>>({});
  const [skConds, setSkConds] = useState<Record<string, Cond>>({});
  const [filterText, setFilterText] = useState("");
  const [consistent, setConsistent] = useState(false);
  const [result, setResult] = useState<{ scanned: number; bytes: number; returned: number; rcu: number; error: string | null } | null>(null);

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
    const parsed = parseFilter(filterText);
    if (parsed.error) {
      setResult({ scanned: 0, bytes: 0, returned: 0, rcu: 0, error: `filter: ${parsed.error}` });
      onHighlight({ matched: new Set(), scanned: new Set() });
      return;
    }
    const filter = parsed.ast ?? null;
    const r = runQuery(state, index, { ...common, filter });
    setResult({ scanned: r.scanned, bytes: r.bytes, returned: r.items.length, rcu: r.rcu, error: r.error });
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
    <div className={open ? "query-panel drawer open" : "query-panel drawer"} aria-hidden={!open}>
      <div className="query-head">
        <span className="q-title">Read</span>
        <div className="seg">
          {(["get", "query", "scan"] as const).map((o) => {
            const disabled = o === "get" && !isBase;
            return (
              <button
                key={o}
                className={o === op ? "active" : ""}
                disabled={disabled}
                title={disabled ? "GetItem is base-table only - GSIs support query/scan" : undefined}
                onClick={() => setOp(o)}
              >
                {o.charAt(0).toUpperCase() + o.slice(1)}
              </button>
            );
          })}
        </div>
        <label className="q-field">
          index
          <select
            value={indexName}
            onChange={(e) => {
              const name = e.target.value;
              setIndexName(name);
              // GetItem can't run on a GSI — fall back to query.
              if (name !== base.name && op === "get") setOp("query");
            }}
          >
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
        <span className="q-flabel">filter</span>
        <input
          className="q-filter-input"
          value={filterText}
          placeholder="e.g.  status = pending AND size(name) > 5 OR begins_with(SK, ORDER#)"
          onChange={(e) => setFilterText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") run();
          }}
          spellCheck={false}
        />
        <span className="q-hint">
          applied after the read - trims results, not cost. = &lt;&gt; &lt; &gt; BETWEEN IN( ) AND OR NOT ( )
          begins_with contains attribute_exists size
        </span>
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
                <b>{result.bytes}</b> bytes
              </span>
              <span className="q-stat">
                <b>{result.returned}</b> returned
              </span>
              <span className="q-stat rcu">
                <b>{result.rcu}</b> RCU
              </span>
              {result.scanned > result.returned && (
                <span className="q-note">
                  you paid to read {result.scanned} but a filter kept {result.returned} - filters don't save RCU
                </span>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
