import { forwardRef } from "react";
import { Editor } from "./Editor";
import type { EditorHandle } from "./Editor";

// The collapsible editor pane: a header showing item/index/pattern counts (and
// a collapse toggle that hands the screen to the tables) above the CodeMirror
// surface. The ref is forwarded through to the Editor so App can patch lines.
export const EditorPane = forwardRef<
  EditorHandle,
  {
    collapsed: boolean;
    onToggleCollapse: () => void;
    itemCount: number;
    gsiCount: number;
    apCount: number;
    // Bumped by App to force a fresh Editor when the whole document is replaced.
    editorKey: number;
    initialDoc: string;
    onChange: (text: string) => void;
    activeLine: number | null;
  }
>(function EditorPane(
  {
    collapsed,
    onToggleCollapse,
    itemCount,
    gsiCount,
    apCount,
    editorKey,
    initialDoc,
    onChange,
    activeLine,
  },
  ref,
) {
  return (
    <div className={collapsed ? "editor-wrap collapsed" : "editor-wrap"}>
      <button
        className="editor-head"
        onClick={onToggleCollapse}
        aria-expanded={!collapsed}
        title={collapsed ? "expand the editor" : "collapse the editor - focus the tables"}
      >
        <span className="chev" aria-hidden>
          ▸
        </span>
        <span className="eh-title">Editor</span>
        <span className="eh-stats">
          {itemCount === 0 ? (
            "empty - load an example or start typing"
          ) : (
            <>
              <b>{itemCount}</b> {itemCount === 1 ? "item" : "items"}
              <i className="sep">·</i>
              <b>{gsiCount}</b> {gsiCount === 1 ? "index" : "indexes"}
              {apCount > 0 && (
                <>
                  <i className="sep">·</i>
                  <b>{apCount}</b> {apCount === 1 ? "pattern" : "patterns"}
                </>
              )}
            </>
          )}
        </span>
      </button>
      {/* inert while collapsed: a zero-height editor must not take focus */}
      <div className="editor-body" inert={collapsed}>
        <Editor
          key={editorKey}
          ref={ref}
          initialDoc={initialDoc}
          onChange={onChange}
          activeLine={activeLine}
          autoFocus={!collapsed}
        />
      </div>
    </div>
  );
});
