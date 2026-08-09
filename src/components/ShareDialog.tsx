import { useEffect } from "react";
import { qrPath } from "../model/qr";
import { SAFE_URL_LEN } from "../model/share";

/**
 * The Share surface: a centered modal with a scannable QR of the model link and
 * a copy-link fallback. Opaque (it's a surface you read from), and it degrades
 * gracefully — too large for a link at all, or too dense for a QR — so the
 * message always matches what the model can actually do.
 */
export function ShareDialog({
  open,
  url,
  copied,
  onCopy,
  onClose,
}: {
  open: boolean;
  url: string;
  copied: boolean;
  onCopy: () => void;
  onClose: () => void;
}) {
  // Esc closes, matching the rail drawers.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const tooBigForUrl = url.length > SAFE_URL_LEN;
  const qr = tooBigForUrl ? null : qrPath(url);

  return (
    <div className="share-overlay" onMouseDown={onClose}>
      <div
        className="share-modal"
        role="dialog"
        aria-label="Share this model"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="share-modal-head">
          <span className="share-modal-title">Share this model</span>
          <button className="share-close" onClick={onClose} aria-label="close">
            &times;
          </button>
        </div>

        {tooBigForUrl ? (
          <p className="share-note">
            This model is too large to fit in a link. Copy the DSL text from the editor and share
            that instead.
          </p>
        ) : (
          <>
            {qr ? (
              <>
                <div className="qr-frame">
                  <svg
                    className="qr"
                    viewBox={`0 0 ${qr.size} ${qr.size}`}
                    shapeRendering="crispEdges"
                    role="img"
                    aria-label="QR code linking to this model"
                  >
                    <path d={qr.d} fill="currentColor" />
                  </svg>
                </div>
                <p className="share-hint">Scan to open this model on another device.</p>
              </>
            ) : (
              <p className="share-note">
                This model fits a link but is too dense for a QR code. Use the link below.
              </p>
            )}
            <div className="share-link-row">
              <input
                className="share-url"
                readOnly
                value={url}
                onFocus={(e) => e.currentTarget.select()}
                aria-label="shareable link"
              />
              <button className="share-copy" onClick={onCopy}>
                {copied ? "Copied" : "Copy link"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
