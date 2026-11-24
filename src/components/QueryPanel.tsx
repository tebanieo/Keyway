import { useState } from "react";
import { pkAttrs, skAttrs } from "../engine/engine";
import { runQuery } from "../engine/query";
import { keyConditionTemplate, parseExpression } from "../engine/expression";
import type { IndexSpec, Item } from "../engine/types";

const schemaOf = (index: IndexSpec) => ({ hash: pkAttrs(index), range: skAttrs(index) });

export interface QueryHighlight {
  matched: Set<string>; // returned items
  scanned: Set<string>; // items read (charged), incl. filtered-out
}

/**
 * A read against the current model: GetItem / Query / Scan. GetItem takes the
 * Key (a value per key attribute); Query takes a real KeyConditionExpression,
 * pre-filled for the chosen index and checked by ExtendDB against its keys.
 * Reports read cost and highlights results.
 *
 * NOTE: first-cut UX, functional, not yet styled to the "professional" bar.
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

  // GetItem: a value per key attribute. Query: the KeyConditionExpression text.
  const [keyVals, setKeyVals] = useState<Record<string, string>>({});
  const [keyText, setKeyText] = useState(() => keyConditionTemplate(schemaOf(base)));
  const [filterText, setFilterText] = useState("");
  const [consistent, setConsistent] = useState(false);
  const [result, setResult] = useState<{
    scanned: number;
    bytes: number;
    returned: number;
    rcu: number;
    error: string | null;
    warnings?: string[];
  } | null>(null);

  const setKeyVal = (a: string, v: string) => setKeyVals((p) => ({ ...p, [a]: v }));
  const fail = (error: string) => {
    setResult({ scanned: 0, bytes: 0, returned: 0, rcu: 0, error });
    onHighlight({ matched: new Set(), scanned: new Set() });
  };

  const run = () => {
    let key = null;
    if (op === "query") {
      const parsedKey = parseExpression(keyText, "key", schemaOf(index));
      if (!parsedKey.expression) return fail(`key: ${parsedKey.error}`);
      key = parsedKey.expression;
    }
    const common = {
      op,
      pk: pks.map((a) => keyVals[a] ?? ""),
      sk: sks.map((a) => keyVals[a] ?? ""),
      key,
      consistent,
    };
    // An empty filter box means no FilterExpression at all (and GetItem has none).
    const parsed = op !== "get" && filterText.trim() ? parseExpression(filterText, "filter") : null;
    if (parsed?.error) return fail(`filter: ${parsed.error}`);
    const filter = parsed?.expression ?? null;
    const r = runQuery(state, index, { ...common, filter });
    setResult({
      scanned: r.scanned,
      bytes: r.bytes,
      returned: r.items.length,
      rcu: r.rcu,
      error: r.error,
      warnings: parsed?.warnings,
    });
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
                title={
                  disabled ? "GetItem is base-table only - GSIs support query/scan" : undefined
                }
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
              const next = indexes.find((i) => i.name === name) ?? base;
              setKeyText(keyConditionTemplate(schemaOf(next)));
              // GetItem can't run on a GSI: fall back to query.
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
          <input
            type="checkbox"
            checked={consistent}
            onChange={(e) => setConsistent(e.target.checked)}
          />
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

      {op === "get" && (
        <div className="query-keys">
          {[...pks, ...sks].map((a) => (
            <label key={a} className="q-field">
              <span className="q-key">{a}</span>
              <span className="q-eq">=</span>
              <input
                value={keyVals[a] ?? ""}
                placeholder="value"
                onChange={(e) => setKeyVal(a, e.target.value)}
              />
            </label>
          ))}
        </div>
      )}

      {op === "query" && (
        <div className="query-filter">
          <span className="q-flabel">key</span>
          <input
            className="q-filter-input q-key-input"
            aria-label="KeyConditionExpression"
            value={keyText}
            onChange={(e) => setKeyText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") run();
            }}
            spellCheck={false}
          />
          <span className="q-hint">
            a real KeyConditionExpression for {index.name}: partition key{pks.length > 1 ? "s" : ""}{" "}
            {pks.join(", ")} with =
            {sks.length > 0 &&
              `, optionally sort key ${sks.join(", ")} with = < <= > >= BETWEEN begins_with`}
            , then its :value=literal pairs.
          </span>
        </div>
      )}

      {op !== "get" && (
        <div className="query-filter">
          <span className="q-flabel">filter</span>
          <input
            className="q-filter-input"
            value={filterText}
            placeholder="e.g.  #s = :p AND size(#n) > :len   #s=status #n=name :p=pending :len=5"
            onChange={(e) => setFilterText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") run();
            }}
            spellCheck={false}
          />
          <span className="q-hint">
            a real DynamoDB FilterExpression, checked by ExtendDB, then its #name=attr and
            :value=literal placeholders. Applied after the read: trims results, not cost.
          </span>
        </div>
      )}

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
                  you paid to read {result.scanned} but a filter kept {result.returned} - filters
                  don't save RCU
                </span>
              )}
              {result.warnings?.map((w) => (
                <span key={w} className="q-note">
                  ⚠ {w}
                </span>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}
