import { useEffect, useState } from "react";

export type Theme = "dark" | "paper";

/** Where an explicit choice (made with the toggle) is remembered. */
const KEY = "keyway-theme";
/**
 * The old key. It was written on every visit, so a stored "dark" says nothing
 * about what the visitor wanted; only "paper" was ever a deliberate choice.
 */
const OLD_KEY = "dc-theme";

const LIGHT = "(prefers-color-scheme: light)";

function systemTheme(): Theme {
  return typeof window.matchMedia === "function" && window.matchMedia(LIGHT).matches
    ? "paper"
    : "dark";
}

/** The visitor's own choice, if they made one; storage may be unavailable. */
function storedChoice(): Theme | null {
  try {
    const v = localStorage.getItem(KEY);
    if (v === "dark" || v === "paper") return v;
    return localStorage.getItem(OLD_KEY) === "paper" ? "paper" : null;
  } catch {
    return null;
  }
}

/** The theme to show on load. main.tsx applies it before the first render, so a
 *  light system doesn't flash dark while the app loads. */
export function initialTheme(): Theme {
  return storedChoice() ?? systemTheme();
}

/**
 * Visual theme (dark "instrument" ⇄ light "paper"), reflected onto the document
 * element as `data-theme`. It follows the system (light or dark), live, until
 * the visitor picks one with the toggle; that choice is remembered.
 */
export function useTheme(): { theme: Theme; toggle: () => void } {
  const [choice, setChoice] = useState<Theme | null>(storedChoice);
  const [system, setSystem] = useState<Theme>(systemTheme);
  const theme = choice ?? system;

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const media = window.matchMedia(LIGHT);
    const onChange = () => setSystem(media.matches ? "paper" : "dark");
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  const toggle = () => {
    const next: Theme = theme === "paper" ? "dark" : "paper";
    setChoice(next);
    try {
      localStorage.setItem(KEY, next);
      localStorage.removeItem(OLD_KEY);
    } catch {
      // storage unavailable (private window): the choice lasts for this visit
    }
  };
  return { theme, toggle };
}
