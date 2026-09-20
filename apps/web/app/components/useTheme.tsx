"use client";

import { useCallback, useEffect, useState } from "react";
import { THEME_KEY } from "./themeScript";

export type Theme = "dark" | "light";

function initialTheme(): Theme {
  if (typeof document !== "undefined") {
    const saved = document.documentElement.getAttribute("data-theme");
    if (saved === "light" || saved === "dark") return saved;
  }
  return "dark";
}

export function useTheme(): { theme: Theme; toggle: () => void } {
  const [theme, setTheme] = useState<Theme>(initialTheme);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {
      // Private mode: theme just won't persist.
    }
  }, [theme]);

  const toggle = useCallback(() => {
    setTheme((t) => (t === "dark" ? "light" : "dark"));
  }, []);

  return { theme, toggle };
}
