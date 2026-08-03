/** Crisp inline icons (no dependency) that inherit color and animate fluidly. */
export function Icon({
  name,
}: {
  name:
    | "play"
    | "pause"
    | "prev"
    | "next"
    | "patterns"
    | "examples"
    | "theme"
    | "query"
    | "learn"
    | "docs";
}) {
  const s = {
    width: 16,
    height: 16,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  switch (name) {
    case "play":
      return (
        <svg {...s} fill="currentColor" stroke="none">
          <path d="M8 5v14l11-7z" />
        </svg>
      );
    case "pause":
      return (
        <svg {...s} fill="currentColor" stroke="none">
          <rect x="6" y="5" width="4" height="14" rx="1" />
          <rect x="14" y="5" width="4" height="14" rx="1" />
        </svg>
      );
    case "prev":
      // Skip-back: a bar with a left-pointing triangle (media-transport style).
      return (
        <svg {...s} fill="currentColor" stroke="none">
          <path d="M7 6h2.2v12H7z" />
          <path d="M20 6.5v11l-8.5-5.5z" />
        </svg>
      );
    case "next":
      // Skip-forward: a right-pointing triangle with a bar.
      return (
        <svg {...s} fill="currentColor" stroke="none">
          <path d="M4 6.5v11l8.5-5.5z" />
          <path d="M14.8 6H17v12h-2.2z" />
        </svg>
      );
    case "patterns":
      return (
        <svg {...s}>
          <path d="M9 6h11M9 12h11M9 18h11" />
          <path d="M4.5 6h.01M4.5 12h.01M4.5 18h.01" />
        </svg>
      );
    case "examples":
      return (
        <svg {...s}>
          <rect x="3" y="3" width="7" height="7" rx="1.5" />
          <rect x="14" y="3" width="7" height="7" rx="1.5" />
          <rect x="3" y="14" width="7" height="7" rx="1.5" />
          <rect x="14" y="14" width="7" height="7" rx="1.5" />
        </svg>
      );
    case "theme":
      return (
        <svg {...s}>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor" stroke="none" />
        </svg>
      );
    case "query":
      return (
        <svg {...s}>
          <circle cx="11" cy="11" r="7" />
          <path d="M21 21l-4.35-4.35" />
        </svg>
      );
    case "learn":
      // An open book: a guided lesson.
      return (
        <svg {...s}>
          <path d="M12 6v14" />
          <path d="M12 6C10 4.5 6.5 4.5 4 5.5V19c2.5-1 6-1 8 .5" />
          <path d="M12 6c2-1.5 5.5-1.5 8-.5V19c-2.5-1-6-1-8 .5" />
        </svg>
      );
    case "docs":
      // A box with an arrow leaving it: opens in a new tab.
      return (
        <svg {...s}>
          <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
          <path d="M15 3h6v6" />
          <path d="M10 14 21 3" />
        </svg>
      );
  }
}

/** The Keyway mark: a gradient tile with a white keyhole (graph in the head,
 *  key-teeth/table rows in the slot). Matches the favicon. */
export function Logo() {
  return (
    <svg width="38" height="38" viewBox="0 0 64 64" aria-hidden>
      <defs>
        <linearGradient id="keyway-tile" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#4c86ff" />
          <stop offset="1" stopColor="#6d4bf0" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="14" fill="url(#keyway-tile)" />
      <g
        transform="translate(32 32) scale(1.2) translate(-22 -30.5)"
        fill="none"
        stroke="#ffffff"
        strokeLinejoin="round"
        strokeLinecap="round"
      >
        {/* keyhole outline */}
        <path
          d="M28.88 29.83 A12 12 0 1 0 15.12 29.83 L14 50 Q14 53 17 53 L27 53 Q30 53 30 50 Z"
          strokeWidth="2.4"
        />
        {/* node-graph in the head */}
        <path
          strokeWidth="1.5"
          d="M22 17.5 L22 11 M22 17.5 L28.5 15.5 M22 17.5 L25.5 23 M22 17.5 L18.5 23 M22 17.5 L15.5 15.5 M22 11 L28.5 15.5 M18.5 23 L15.5 15.5"
        />
        {/* key-teeth / table rows in the slot */}
        <path
          strokeWidth="1.7"
          d="M18.5 34 H25 M18.5 37.5 H22 M18.5 41 H26.5 M18.5 44.5 H23 M18.5 48 H25.5"
        />
      </g>
      <g transform="translate(32 32) scale(1.2) translate(-22 -30.5)" fill="#ffffff">
        <circle cx="22" cy="17.5" r="1.7" />
        <circle cx="22" cy="11" r="1.7" />
        <circle cx="28.5" cy="15.5" r="1.7" />
        <circle cx="25.5" cy="23" r="1.7" />
        <circle cx="18.5" cy="23" r="1.7" />
        <circle cx="15.5" cy="15.5" r="1.7" />
      </g>
    </svg>
  );
}
