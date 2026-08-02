import { useEffect, useState } from "react";

export type Theme = "dark" | "paper";

/**
 * Visual theme (dark "instrument" ⇄ light "paper"), reflected onto the document
 * element as `data-theme` and persisted to localStorage.
 */
export function useTheme(): { theme: Theme; toggle: () => void } {
  const [theme, setTheme] = useState<Theme>(() =>
    localStorage.getItem("dc-theme") === "paper" ? "paper" : "dark",
  );
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("dc-theme", theme);
  }, [theme]);
  return { theme, toggle: () => setTheme((t) => (t === "paper" ? "dark" : "paper")) };
}
