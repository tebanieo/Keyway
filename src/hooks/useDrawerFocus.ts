import { useEffect, useRef } from "react";
import type { RefObject } from "react";

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Keyboard behaviour for a side drawer:
 * - opening it moves focus inside (to `initial`, else its first focusable
 *   control), so the keyboard follows the eye;
 * - Escape inside it closes it;
 * - closing it returns focus to whatever had it before (the rail button, or
 *   the editor), never leaving focus on a control that just became hidden.
 */
export function useDrawerFocus(
  open: boolean,
  root: RefObject<HTMLElement | null>,
  onClose: () => void,
  initial?: string,
) {
  const invoker = useRef<HTMLElement | null>(null);
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    const el = root.current;
    if (!el) return;
    if (open) {
      invoker.current = document.activeElement as HTMLElement | null;
      // After the browser has applied `inert={false}`, or focus won't land.
      const frame = requestAnimationFrame(() => {
        const target =
          (initial && el.querySelector<HTMLElement>(initial)) ||
          el.querySelector<HTMLElement>(FOCUSABLE);
        target?.focus({ preventScroll: true });
      });
      return () => cancelAnimationFrame(frame);
    }
    // Closing: give focus back if it was inside the drawer (or lost).
    const back = invoker.current;
    invoker.current = null;
    const lost = !document.activeElement || document.activeElement === document.body;
    if (back?.isConnected && (lost || el.contains(document.activeElement))) {
      back.focus({ preventScroll: true });
    }
  }, [open, root, initial]);

  useEffect(() => {
    const el = root.current;
    if (!el || !open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.defaultPrevented) {
        e.stopPropagation();
        close.current();
      }
    };
    el.addEventListener("keydown", onKey);
    return () => el.removeEventListener("keydown", onKey);
  }, [open, root]);
}
