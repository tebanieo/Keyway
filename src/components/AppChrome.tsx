// Small static chrome pieces around the app: the contextual hint line, the
// footer, and the transient "copied <value>" toast. Grouped here so App reads
// as a composition rather than carrying leaf markup.
import type { SchemaChange } from "../model/schemaChange";

/**
 * The current step's narration, in full, above the tables: it's what the step
 * is teaching, so it sits where you're looking and wraps instead of being cut.
 * Always there while a model has steps (a step without a note shows what it
 * does), so the tables don't jump as notes come and go. Screen readers hear
 * steps through the status bar's announcement, not from here.
 */
export function StepNote({
  text,
  step,
  total,
  fallback,
}: {
  text?: string;
  step: number;
  total: number;
  fallback: string;
}) {
  return (
    <p className={text ? "step-note" : "step-note quiet"}>
      <span className="step-note-n">
        Step {step}/{total}
      </span>
      <span>{text ?? fallback}</span>
    </p>
  );
}

/**
 * How to drive the app. In full while the model is empty (the moment it's
 * needed); once there's something on screen, one line of where to look.
 */
/** What a key change in `@table` / `@gsi` would be in real DynamoDB. */
export function SchemaNote({ notes, onDismiss }: { notes: SchemaChange[]; onDismiss: () => void }) {
  if (notes.length === 0) return null;
  return (
    <div className="schema-note" role="note" aria-label="In real DynamoDB">
      <div className="schema-note-body">
        <b>In real DynamoDB</b>
        {notes.map((n) => (
          <p key={`${n.kind}:${n.index}`}>{n.message}</p>
        ))}
      </div>
      <button className="ghost" onClick={onDismiss}>
        Got it
      </button>
    </div>
  );
}

export function AppHint({ empty }: { empty: boolean }) {
  if (!empty) {
    return (
      <p className="hint">
        Double-click a cell to edit it (written into the script) · <kbd>Ctrl/⌘ K</kbd> any action ·{" "}
        <kbd>?</kbd> shortcuts
      </p>
    );
  }
  return (
    <ul className="hint hint-start">
      <li>
        Type in the script: <code>item</code> then <kbd>Tab</kbd> scaffolds a row.
      </li>
      <li>
        <code>@gsi GSI2 pk=GSI2PK sk=GSI2SK</code> adds an index, and a pane for it.
      </li>
      <li>
        <kbd>Esc</kbd> then <kbd>Tab</kbd> leaves the script · <kbd>Ctrl/⌘ K</kbd> any action ·{" "}
        <kbd>?</kbd> shortcuts
      </li>
    </ul>
  );
}

export function AppFooter() {
  return (
    <footer className="app-footer">
      <span className="disclaimer">
        A personal project. Opinions are my own, not those of AWS or Amazon.{" "}
        <a href="https://github.com/tebanieo/Keyway" target="_blank" rel="noopener noreferrer">
          Source
        </a>
        .
      </span>
      <span className="copyright">© 2026 tebanieo</span>
    </footer>
  );
}

export function CopiedToast({ value }: { value: string | null }) {
  if (value === null) return null;
  return (
    <div className="copied-toast" role="status">
      copied <code>{value}</code>
    </div>
  );
}

/** After Reset: the model is gone, so offer it back for a while. */
export function ResetToast({ onUndo }: { onUndo: (() => void) | null }) {
  if (!onUndo) return null;
  return (
    <div className="copied-toast reset-toast" role="status">
      Model reset.
      <button className="reset-undo" onClick={onUndo}>
        Undo
      </button>
    </div>
  );
}
