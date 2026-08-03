import { Drawer } from "./Rail";
import { apCoverage } from "../model/coverage";
import type { CoverageStatus } from "../model/coverage";
import type { AccessPattern } from "../model/dsl";
import type { IndexSpec, Item } from "../engine/types";

/** How each coverage status renders: mark glyph + severity class. */
const COVER_UI: Record<CoverageStatus, { mark: string; kind: "ok" | "warn" | "bad" }> = {
  served: { mark: "✓", kind: "ok" },
  empty: { mark: "⚠", kind: "warn" },
  invalid: { mark: "⚠", kind: "warn" },
  assigned: { mark: "~", kind: "warn" },
  "no-index": { mark: "✗", kind: "bad" },
  unassigned: { mark: "✗", kind: "bad" },
};

/**
 * The access-pattern SPEC + coverage (v2). Each `@ap` carries a declared query
 * (`-> Index` + key conditions); we RUN it against the finished model and grade
 * the result: served / empty / invalid / assigned / gap. This is the original
 * "does my design serve all my access patterns?" validation, and an invalid
 * query shows the exact key rule it broke.
 */
export function AccessPatterns({
  open,
  aps,
  base,
  gsis,
  state,
  onClose,
}: {
  open: boolean;
  aps: AccessPattern[];
  base: IndexSpec;
  gsis: IndexSpec[];
  state: Map<string, Item>;
  onClose: () => void;
}) {
  const indexes = [base, ...gsis];
  const rows = aps.map((ap) => ({ ap, cov: apCoverage(ap, indexes, state) }));
  const served = rows.filter((r) => r.cov.status === "served").length;
  const gaps = rows.filter((r) => COVER_UI[r.cov.status].kind === "bad").length;

  return (
    <Drawer
      open={open}
      title="Access Patterns"
      onClose={onClose}
      head={
        <>
          <span className={served === aps.length ? "ap-count all" : "ap-count"}>
            {served}/{aps.length} served
          </span>
          {gaps > 0 && <span className="ap-gaps">{gaps} unserved</span>}
        </>
      }
    >
      <div className="ap-list">
        {rows.map(({ ap, cov }) => {
          const ui = COVER_UI[cov.status];
          return (
            <div className={`ap-row ${ui.kind}`} key={ap.n}>
              <div className="ap-row-top">
                <span className={`ap-mark ${ui.kind}`}>{ui.mark}</span>
                <span className="ap-n">AP{ap.n}</span>
                <span className="ap-desc">{ap.description}</span>
                {ap.index && <span className="ap-idx">{ap.index}</span>}
              </div>
              <div className={`ap-msg ${ui.kind}`}>{cov.message}</div>
            </div>
          );
        })}
      </div>
      <div className="ap-foot">
        Declare with <code>@ap description -&gt; Index key=value</code>. Coverage runs the query -{" "}
        <b>served</b> means it returns data.
      </div>
    </Drawer>
  );
}
