import { useState } from "react";
import { shareUrl } from "../model/share";
import { track } from "../analytics";

// The share modal. Its URL is snapshotted when the modal opens, so the QR and
// copy button reflect one moment even if the model changes underneath. `open`
// takes the current model text; the caller decides what "current" means
// (editor buffer vs serialized canvas ops).
export function useShare() {
  const [url, setUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const open = (doc: string) => {
    setUrl(shareUrl(doc));
    setCopied(false);
  };

  const close = () => setUrl(null);

  const copy = async () => {
    if (url === null) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      track("link-shared");
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      console.log(url);
    }
  };

  return { url, copied, open, close, copy };
}
