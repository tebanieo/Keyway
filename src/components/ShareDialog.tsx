import { useEffect } from "react";
import { qrPath, qrLogoFraction } from "../model/qr";
import type { QrLevel } from "../model/qr";
import { SAFE_URL_LEN } from "../model/share";

/**
 * The Keyway keyhole at the center of the QR: a brand tile sitting on a white
 * knockout (so the scanner reads clean quiet space behind it), with a filled
 * white keyhole silhouette. Sized to the code's correction level so the erased
 * modules stay within its recovery budget. Coordinates are in module units.
 */
function QrKeyhole({ size, level }: { size: number; level: QrLevel }) {
  const box = size * qrLogoFraction(level); // tile side
  const pad = box * 0.14; // white margin around the tile
  const outer = box + pad * 2;
  const center = size / 2;
  const rx = box * 0.24;
  return (
    <g shapeRendering="geometricPrecision">
      <rect
        x={center - outer / 2}
        y={center - outer / 2}
        width={outer}
        height={outer}
        rx={rx * 1.3}
        fill="#ffffff"
      />
      <rect
        x={center - box / 2}
        y={center - box / 2}
        width={box}
        height={box}
        rx={rx}
        fill="url(#qr-keyway)"
      />
      {/* Keyhole drawn in a 0..24 space and scaled into the tile. */}
      <svg x={center - box / 2} y={center - box / 2} width={box} height={box} viewBox="0 0 24 24">
        <circle cx="12" cy="9.2" r="4.4" fill="#ffffff" />
        <path
          d="M9.7 12 L8.9 18.6 Q8.9 20 10.3 20 L13.7 20 Q15.1 20 15.1 18.6 L14.3 12 Z"
          fill="#ffffff"
        />
      </svg>
    </g>
  );
}

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
                    role="img"
                    aria-label="QR code linking to this model"
                  >
                    <defs>
                      <linearGradient id="qr-keyway" x1="0" y1="0" x2="1" y2="1">
                        <stop offset="0" stopColor="#4c86ff" />
                        <stop offset="1" stopColor="#6d4bf0" />
                      </linearGradient>
                    </defs>
                    <path d={qr.d} fill="currentColor" shapeRendering="crispEdges" />
                    <QrKeyhole size={qr.size} level={qr.level} />
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
