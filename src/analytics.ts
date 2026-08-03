/**
 * The entire analytics surface of Keyway, in one place so it's auditable.
 *
 * It fires an anonymous COUNT to GoatCounter for a named event (e.g.
 * "example-opened") and nothing else: no user data, no model, no identifiers.
 * It's a no-op when the counter didn't load, which is the case on localhost
 * (see index.html) and if a visitor blocks it. That's the whole file. Read it.
 */
interface GoatCounter {
  count?: (opts: { path: string; event: boolean }) => void;
}

declare global {
  interface Window {
    goatcounter?: GoatCounter;
  }
}

/** Record an anonymous usage event (just its name). Silently does nothing if
 *  the counter isn't present. */
export function track(event: string): void {
  window.goatcounter?.count?.({ path: event, event: true });
}
