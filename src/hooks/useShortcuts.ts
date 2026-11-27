import { useEffect, useRef, useState } from "react";

/** One single-key shortcut: the key as `KeyboardEvent.key`, and what it does. */
export interface Shortcut {
  key: string;
  label: string;
  run: () => void;
}

const PREF = "keyway.shortcuts";

function readPref(): boolean {
  try {
    return localStorage.getItem(PREF) !== "off";
  } catch {
    return true;
  }
}

/** Typing into something: a field, a select, or the script editor. */
function isTyping(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  return t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName);
}

/**
 * Keyboard shortcuts for the whole app:
 * - Ctrl/Cmd+K opens the command palette, from anywhere (the editor included);
 * - single keys (`q`, `]`, `?`…) act only when you're not typing, and can be
 *   switched off (the choice is remembered in this browser).
 */
export function useShortcuts(shortcuts: Shortcut[], onPalette: () => void) {
  const [enabled, setEnabledState] = useState(readPref);
  const latest = useRef({ shortcuts, onPalette, enabled });
  latest.current = { shortcuts, onPalette, enabled };

  const setEnabled = (on: boolean) => {
    setEnabledState(on);
    try {
      localStorage.setItem(PREF, on ? "on" : "off");
    } catch {
      // private mode or blocked storage: the switch still works for this visit
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const { shortcuts, onPalette, enabled } = latest.current;
      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        e.stopPropagation();
        onPalette();
        return;
      }
      if (!enabled || e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
      if (isTyping(e.target) || document.querySelector("dialog[open]")) return;
      const hit = shortcuts.find((s) => s.key === e.key);
      if (!hit) return;
      e.preventDefault();
      hit.run();
    };
    // Capture, so Ctrl/Cmd+K wins over the editor's own bindings.
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  return { enabled, setEnabled };
}
