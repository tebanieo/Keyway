import { compressToEncodedURIComponent, decompressFromEncodedURIComponent } from "lz-string";

/**
 * Encode a model (its DSL text) into a URL-safe, compressed string for the
 * `#m=` fragment. Fully client-side; the fragment is never sent to a server,
 * so a shared link's contents stay on the two machines that hold it.
 */
export function encodeModel(text: string): string {
  return compressToEncodedURIComponent(text);
}

/** Decode a `#m=` payload back to DSL text, or null if it isn't valid. */
export function decodeModel(param: string): string | null {
  try {
    const text = decompressFromEncodedURIComponent(param);
    return text && text.length > 0 ? text : null;
  } catch {
    return null;
  }
}

/**
 * Build a shareable link for the current page carrying the model in its
 * fragment. Uses the current origin+path so it works on localhost and on
 * GitHub Pages (base path included) alike.
 */
export function shareUrl(text: string): string {
  return `${location.origin}${location.pathname}#m=${encodeModel(text)}`;
}

/** Read a model out of the current URL fragment (`#m=…`), if present. */
export function modelFromLocation(hash: string): string | null {
  const q = hash.startsWith("#") ? hash.slice(1) : hash;
  const param = new URLSearchParams(q).get("m");
  return param ? decodeModel(param) : null;
}

/**
 * Practical ceiling before a link gets awkward to paste in chat apps. Real
 * browsers allow far more, but we warn past this and suggest copy-paste.
 */
export const SAFE_URL_LEN = 8000;
