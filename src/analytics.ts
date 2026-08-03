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

/** Record an anonymous event scoped to a named item, e.g.
 *  `trackItem("example", "Users & orders")` counts `example:users-orders`.
 *  The item name is slugified so the event is a stable, readable label — it's
 *  still just a name, never anything the visitor typed. Used to see which
 *  examples and learn paths are popular, each as its own row in the dashboard. */
export function trackItem(category: string, name: string): void {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  track(`${category}:${slug}`);
}
