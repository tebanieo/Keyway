import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { initExtendDB } from "./engine/extenddb";
import { initialTheme } from "./hooks/useTheme";
// Self-hosted fonts (bundled, no external CDN, keeps the tool zero-telemetry).
// Space Grotesk for UI chrome, JetBrains Mono for data/keys.
import "@fontsource/space-grotesk/400.css";
import "@fontsource/space-grotesk/500.css";
import "@fontsource/space-grotesk/600.css";
import "@fontsource/space-grotesk/700.css";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/500.css";
import "@fontsource/jetbrains-mono/600.css";
import "./styles.css";

// ExtendDB (WASM, bundled and served with this site; nothing else is fetched)
// evaluates every condition, so it must be ready before the first parse.
document.documentElement.setAttribute("data-theme", initialTheme());
const root = document.getElementById("root")!;
initExtendDB().then(
  () =>
    createRoot(root).render(
      <StrictMode>
        <App />
      </StrictMode>,
    ),
  (err: unknown) => {
    root.textContent = `Keyway couldn't load its DynamoDB engine (ExtendDB WASM): ${String(err)}`;
  },
);
