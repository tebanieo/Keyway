import { useEffect, useMemo, useRef, useState } from "react";
import { useDrawerFocus } from "../hooks/useDrawerFocus";
import { pkAttrs, skAttrs } from "../engine/engine";
import { runQuery } from "../engine/query";
import { compileExpression, splitClauses } from "../engine/expression";
import type { AttributeValue } from "../engine/extenddb";
import {
  SORT_KEY_OPS,
  SORT_KEY_OP_HELP,
  attributeTypes,
  getKeyTemplate,
  keyConditionRequest,
  typeMismatches,
} from "../engine/keyhelp";
import type { SortKeyOp } from "../engine/keyhelp";
import type { Expression, IndexSpec, Item } from "../engine/types";
import { parseGetKey } from "../model/dsl";
import type { AccessPattern } from "../model/dsl";
import { cliCommand, pick, refsIn, unusedAcross } from "../model/request";

const schemaOf = (index: IndexSpec) => ({ hash: pkAttrs(index), range: skAttrs(index) });
/** A JSON object with one entry per line, each value compact:
 *  `{\n  ":pk": {"S": "U#1"},\n  ":sk": {"S": ""}\n}`, as people write them. */
const compact = (val: unknown): string =>
  typeof val === "object" && val !== null && !Array.isArray(val)
    ? `{${Object.entries(val)
        .map(([k, x]) => `${JSON.stringify(k)}: ${JSON.stringify(x)}`)
        .join(", ")}}`
    : JSON.stringify(val);
const pretty = (v: Record<string, unknown>) => {
  const lines = Object.entries(v).map(([k, val]) => `  ${JSON.stringify(k)}: ${compact(val)}`);
  return lines.length ? `{\n${lines.join(",\n")}\n}` : "{}";
};

/** Parse a JSON field; empty means `{}`. */
function readJson(label: string, text: string): Record<string, unknown> | string {
  if (text.trim() === "") return {};
  try {
    const v: unknown = JSON.parse(text);
    if (typeof v === "object" && v !== null && !Array.isArray(v)) {
      return v as Record<string, unknown>;
    }
    return `${label} must be a JSON object`;
  } catch (e) {
    return `${label} isn't valid JSON: ${e instanceof Error ? e.message : String(e)}`;
  }
}

export interface QueryHighlight {
  matched: Set<string>; // returned items
  scanned: Set<string>; // items read (charged), incl. filtered-out
}

/**
 * A read against the current model, written as the real API request: GetItem
 * takes a typed `Key`; Query takes a KeyConditionExpression; Query and Scan
 * take a FilterExpression; both expressions share ExpressionAttributeNames and
 * ExpressionAttributeValues, as in the API. ExtendDB validates everything. The
 * sort-key buttons write a KeyConditionExpression for each operator, typed
 * from what the table holds, and the matching AWS CLI command is shown live.
 */
export function QueryPanel({
  open,
  base,
  gsis,
  state,
  onHighlight,
  onClose,
  request,
}: {
  /** A pattern to load and run (Ctrl/Cmd+Enter on an `@ap` line). */
  request?: { seq: number; ap: AccessPattern } | null;
  open: boolean;
  base: IndexSpec;
  gsis: IndexSpec[];
  state: Map<string, Item>;
  onHighlight: (h: QueryHighlight) => void;
  onClose: () => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  // Opening focuses the request's first field; Escape closes; focus goes back.
  useDrawerFocus(
    open,
    panelRef,
    onClose,
    'textarea[aria-label="Key"], input[aria-label="KeyConditionExpression"], input[aria-label="FilterExpression"]',
  );
  const indexes = [base, ...gsis];
  const [op, setOp] = useState<"get" | "query" | "scan">("query");
  const [indexName, setIndexName] = useState(base.name);
  const index = indexes.find((i) => i.name === indexName) ?? base;
  const isBase = index.name === base.name;
  const schema = schemaOf(index);
  const types = useMemo(() => attributeTypes(state.values()), [state]);

  /** The partition-key values of a real item in `ix`, typed, so a fresh
   *  template runs as-is the first time (`{":pk": {"S": "USER#1"}}`). */
  const sampleKey = (ix: IndexSpec): Record<string, AttributeValue> => {
    const hash = pkAttrs(ix);
    const item = [...state.values()].find((it) => hash.every((a) => it.attrs[a]));
    if (!item) return {};
    return Object.fromEntries(
      hash.map((a, i) => {
        const v = item.attrs[a];
        const ref = hash.length > 1 ? `:pk${i + 1}` : ":pk";
        return [ref, types.get(a) === "N" ? { N: v } : { S: v }];
      }),
    );
  };
  const fresh = (ix: IndexSpec, sortOp: SortKeyOp | null = null) => {
    const req = keyConditionRequest(schemaOf(ix), sortOp, types, sampleKey(ix));
    return {
      key: req.expression,
      names: Object.keys(req.names).length ? pretty(req.names) : "",
      values: pretty(req.values),
      getKey: pretty(getKeyTemplate(schemaOf(ix), types)),
    };
  };
  const [initial] = useState(() => fresh(base));
  const [keyText, setKeyText] = useState(initial.key);
  const [namesText, setNamesText] = useState(initial.names);
  const [valuesText, setValuesText] = useState(initial.values);
  const [getKeyText, setGetKeyText] = useState(initial.getKey);
  const [filterText, setFilterText] = useState("");
  const [sortOp, setSortOp] = useState<SortKeyOp | null>(null);
  const [consistent, setConsistent] = useState(false);
  const [copied, setCopied] = useState(false);
  const [result, setResult] = useState<{
    scanned: number;
    bytes: number;
    returned: number;
    rcu: number;
    error: string | null;
    warnings?: string[];
    items?: Item[];
    index?: IndexSpec;
  } | null>(null);

  const reset = (ix: IndexSpec) => {
    const f = fresh(ix);
    setKeyText(f.key);
    setNamesText(f.names);
    setValuesText(f.values);
    setGetKeyText(f.getKey);
    setSortOp(null);
  };

  // Opening the panel with an untouched, empty template (it mounted before the
  // model had data): pre-fill it from the table now.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    const untouched = valuesText === pretty(keyConditionRequest(schema, null, types).values);
    if (open && untouched && Object.keys(sampleKey(index)).length) reset(index);
  }

  // When the queried index's keys change under the panel (the document's
  // @table or @gsi was edited, or the selected GSI was removed), start over
  // from a fresh template rather than keep one written for the old keys.
  const schemaSig = JSON.stringify([index.name, schema]);
  const [templateSig, setTemplateSig] = useState(schemaSig);
  if (templateSig !== schemaSig) {
    setTemplateSig(schemaSig);
    reset(index);
  }

  // An @ap sent from the editor: write it into the request and run it. After
  // the pre-fill and key-change resets above, so the pattern wins.
  const [loadedSeq, setLoadedSeq] = useState(0);
  const [runSeq, setRunSeq] = useState(0);
  if (request && request.seq !== loadedSeq) {
    setLoadedSeq(request.seq);
    const { ap } = request;
    const ix = indexes.find((i) => i.name === ap.index) ?? base;
    const readOp = ap.readOp ?? "query";
    const text = ap.keyText ?? "";
    setIndexName(ix.name);
    setOp(readOp);
    setTemplateSig(JSON.stringify([ix.name, schemaOf(ix)]));
    setSortOp(null);
    setFilterText("");
    if (readOp === "get") {
      const k = parseGetKey(text);
      setGetKeyText(typeof k === "string" ? text : pretty(k));
    } else if (readOp === "query") {
      const split = splitClauses(text, ["names", "values"]);
      if ("error" in split) {
        setKeyText(text);
      } else {
        const { names, values } = split.clauses as Record<string, Record<string, unknown>>;
        setKeyText(split.expression);
        setNamesText(names && Object.keys(names).length ? pretty(names) : "");
        setValuesText(pretty(values ?? {}));
      }
    }
    setRunSeq(request.seq);
  }

  /** A sort-key button: rewrite the key condition for `sortOp`, keeping the
   *  values already typed and anything the filter uses. */
  const applySortOp = (next: SortKeyOp | null) => {
    const names = readJson("ExpressionAttributeNames", namesText);
    const values = readJson("ExpressionAttributeValues", valuesText);
    const oldValues = typeof values === "string" ? {} : (values as Record<string, AttributeValue>);
    const req = keyConditionRequest(schema, next, types, oldValues);
    const isKeyRef = (k: string) => /^[#:](pk|sk)\d*$/.test(k);
    const keepNames = typeof names === "string" ? {} : names;
    const mergedNames = {
      ...Object.fromEntries(Object.entries(keepNames).filter(([k]) => !isKeyRef(k))),
      ...req.names,
    };
    const mergedValues = {
      ...Object.fromEntries(Object.entries(oldValues).filter(([k]) => !isKeyRef(k))),
      ...req.values,
    };
    setSortOp(next);
    setKeyText(req.expression);
    setNamesText(Object.keys(mergedNames).length ? pretty(mergedNames) : "");
    setValuesText(pretty(mergedValues));
  };

  const fail = (error: string) => {
    setResult({ scanned: 0, bytes: 0, returned: 0, rcu: 0, error });
    onHighlight({ matched: new Set(), scanned: new Set() });
  };

  const run = () => {
    const filterOn = op !== "get" && filterText.trim() !== "";
    let getKey = null;
    let key: Expression | null = null;
    let filter: Expression | null = null;
    const warnings: string[] = [];

    if (op === "get") {
      const k = parseGetKey(`key=${getKeyText}`);
      if (typeof k === "string") return fail(`Key: ${k}`);
      getKey = k;
    } else {
      const allNames = readJson("ExpressionAttributeNames", namesText);
      if (typeof allNames === "string") return fail(allNames);
      const allValues = readJson("ExpressionAttributeValues", valuesText);
      if (typeof allValues === "string") return fail(allValues);
      // A Scan sends no KeyConditionExpression, so it leaves out the entries
      // only the key condition uses (still in the shared fields from Query).
      const keyOnly = op === "query" ? null : refsIn(keyText);
      const filterRefs = refsIn(filterOn ? filterText : "");
      const drop = (k: string) =>
        !!keyOnly &&
        (keyOnly.names.has(k) || keyOnly.values.has(k)) &&
        !filterRefs.names.has(k) &&
        !filterRefs.values.has(k);
      const names = Object.fromEntries(Object.entries(allNames).filter(([k]) => !drop(k)));
      const values = Object.fromEntries(Object.entries(allValues).filter(([k]) => !drop(k)));
      // Each expression is validated with the entries it uses; the request as
      // a whole must use every entry, as the API requires.
      const part = (expression: string) => {
        const refs = refsIn(expression);
        return {
          expression,
          names: pick(names, refs.names),
          values: pick(values, refs.values),
        };
      };
      if (op === "query") {
        const parsed = compileExpression(part(keyText), "key", schema);
        if (!parsed.expression) return fail(`KeyConditionExpression: ${parsed.error}`);
        key = parsed.expression;
        warnings.push(...parsed.warnings, ...typeMismatches(key, types));
      }
      if (filterOn) {
        const parsed = compileExpression(part(filterText), "filter");
        if (!parsed.expression) return fail(`FilterExpression: ${parsed.error}`);
        filter = parsed.expression;
        warnings.push(...parsed.warnings, ...typeMismatches(filter, types));
      }
      const used = [op === "query" ? keyText : "", filterOn ? filterText : ""];
      const unused = unusedAcross(
        used,
        names as Record<string, string>,
        values as Record<string, AttributeValue>,
      );
      if (unused) return fail(unused);
    }

    const spec = { op, getKey, key, consistent };
    const r = runQuery(state, index, { ...spec, filter }, base);
    setResult({
      scanned: r.scanned,
      bytes: r.bytes,
      returned: r.items.length,
      rcu: r.rcu,
      error: r.error,
      warnings,
      items: r.items,
      index,
    });
    if (r.error) {
      onHighlight({ matched: new Set(), scanned: new Set() });
      return;
    }
    // the "read" set (before filter) drives the faint "you paid for this" highlight
    const read = runQuery(state, index, { ...spec, filter: null }, base);
    onHighlight({
      matched: new Set(r.items.map((i) => i.id)),
      scanned: new Set(read.items.map((i) => i.id)),
    });
  };

  useEffect(() => {
    if (runSeq) run();
    // Only when a new pattern arrives; `run` reads the fields just written.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runSeq]);

  const clear = () => {
    setResult(null);
    onHighlight({ matched: new Set(), scanned: new Set() });
  };

  // The CLI command, best effort while the JSON is half-typed.
  const loose = (text: string) => {
    const v = readJson("", text);
    return typeof v === "string" ? undefined : v;
  };
  // The CLI sends the entries its expressions use (a Scan has no key condition).
  const sent = refsIn([op === "query" ? keyText : "", filterText].join(" "));
  const sentNames = loose(namesText) as Record<string, string> | undefined;
  const sentValues = loose(valuesText) as Record<string, AttributeValue> | undefined;
  const cli = cliCommand({
    op,
    tableName: base.name,
    indexName: isBase ? undefined : index.name,
    key: loose(getKeyText) as Record<string, AttributeValue> | undefined,
    keyConditionExpression: keyText,
    filterExpression: filterText.trim() || undefined,
    names: sentNames && pick(sentNames, sent.names),
    values: sentValues && pick(sentValues, sent.values),
    consistentRead: consistent,
  });
  const copy = () => {
    void navigator.clipboard?.writeText(cli).then(
      () => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1500);
      },
      () => {},
    );
  };
  const enterRuns = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey && e.currentTarget.tagName === "INPUT") run();
  };

  return (
    <div
      ref={panelRef}
      // Ctrl/Cmd+Enter runs the request from any field, the JSON ones included.
      onKeyDown={(e) => {
        if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
          e.preventDefault();
          run();
        }
      }}
      className={open ? "query-panel drawer open" : "query-panel drawer"}
      role="dialog"
      aria-label="Read / Query"
      aria-hidden={!open}
      inert={!open} // closed: off-screen, so no tab stops
    >
      <div className="query-head">
        <span className="q-title">Read</span>
        <div className="seg">
          {(["get", "query", "scan"] as const).map((o) => {
            const disabled = o === "get" && !isBase;
            return (
              <button
                key={o}
                className={o === op ? "active" : ""}
                aria-pressed={o === op}
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
        <button className="q-close" onClick={onClose} title="close" aria-label="Close Read / Query">
          &times;
        </button>
      </div>

      <div className="q-request">
        {op === "get" && (
          <label className="q-param">
            <span className="q-pname">Key</span>
            <textarea
              aria-label="Key"
              rows={4}
              value={getKeyText}
              onChange={(e) => setGetKeyText(e.target.value)}
              spellCheck={false}
            />
            <span className="q-hint">
              every key attribute of {index.name}, typed: {'{"S": "…"}'} for a String,{" "}
              {'{"N": "…"}'} for a Number
            </span>
          </label>
        )}

        {op === "query" && (
          <>
            <label className="q-param">
              <span className="q-pname">KeyConditionExpression</span>
              <input
                aria-label="KeyConditionExpression"
                value={keyText}
                onChange={(e) => setKeyText(e.target.value)}
                onKeyDown={enterRuns}
                spellCheck={false}
              />
            </label>
            <div className="q-ops" role="group" aria-label="sort key condition">
              <span className="q-hint">
                {schema.range.length ? `sort key ${schema.range[0]}:` : "no sort key"}
              </span>
              <button
                className={sortOp === null ? "active" : ""}
                aria-pressed={sortOp === null}
                title="partition key only: read the whole partition"
                onClick={() => applySortOp(null)}
              >
                none
              </button>
              {schema.range.length > 0 &&
                SORT_KEY_OPS.map((o) => (
                  <button
                    key={o}
                    className={sortOp === o ? "active" : ""}
                    aria-pressed={sortOp === o}
                    title={SORT_KEY_OP_HELP[o]}
                    onClick={() => applySortOp(o)}
                  >
                    {o}
                  </button>
                ))}
            </div>
          </>
        )}

        {op !== "get" && (
          <>
            <label className="q-param">
              <span className="q-pname">FilterExpression</span>
              <input
                aria-label="FilterExpression"
                value={filterText}
                placeholder="optional, e.g.  #s = :p"
                onChange={(e) => setFilterText(e.target.value)}
                onKeyDown={enterRuns}
                spellCheck={false}
              />
              <span className="q-hint">applied after the read: trims results, not cost</span>
            </label>
            <label className="q-param">
              <span className="q-pname">ExpressionAttributeNames</span>
              <textarea
                aria-label="ExpressionAttributeNames"
                rows={2}
                value={namesText}
                placeholder='optional, e.g. {"#s": "status"}'
                onChange={(e) => setNamesText(e.target.value)}
                spellCheck={false}
              />
            </label>
            <label className="q-param">
              <span className="q-pname">ExpressionAttributeValues</span>
              <textarea
                aria-label="ExpressionAttributeValues"
                rows={4}
                value={valuesText}
                onChange={(e) => setValuesText(e.target.value)}
                spellCheck={false}
              />
              <span className="q-hint">
                typed as in the API; the buttons above type them from what {base.name} holds
              </span>
            </label>
          </>
        )}
      </div>

      {result && (
        // Announced: an error as an alert, a result as a polite status.
        <div
          className={result.error ? "query-result err" : "query-result"}
          role={result.error ? "alert" : "status"}
        >
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

      {result && !result.error && result.items && result.index && (
        <ReturnedItems items={result.items} index={result.index} />
      )}

      <div className="q-cli">
        <div className="q-cli-head">
          <span className="q-pname">AWS CLI</span>
          <button className="q-clear" onClick={copy}>
            {copied ? "copied" : "copy"}
          </button>
        </div>
        <pre aria-label="AWS CLI command">{cli}</pre>
      </div>
    </div>
  );
}

const SHOWN = 50;

/** What the request returned, as DynamoDB would hand it back: keys first. */
function ReturnedItems({ items, index }: { items: Item[]; index: IndexSpec }) {
  if (items.length === 0) return <div className="q-items empty">no items returned</div>;
  const keys = [...pkAttrs(index), ...skAttrs(index)];
  return (
    <ol className="q-items" aria-label="Returned items">
      {items.slice(0, SHOWN).map((it) => {
        const rest = Object.entries(it.attrs).filter(([k]) => !keys.includes(k));
        return (
          <li key={it.id}>
            <span className="q-item-key">{keys.map((k) => it.attrs[k] ?? "·").join(" / ")}</span>
            {rest.length > 0 && (
              <span className="q-item-rest">{rest.map(([k, v]) => `${k}=${v}`).join("  ")}</span>
            )}
          </li>
        );
      })}
      {items.length > SHOWN && <li className="q-more">+{items.length - SHOWN} more</li>}
    </ol>
  );
}
