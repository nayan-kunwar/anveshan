"use client";

import type { ReactNode } from "react";
import { useTheme } from "./useTheme";

export default function ThemeToggle(): ReactNode {
  const { theme, toggle } = useTheme();
  return (
    <button
      type="button"
      className="icon-btn"
      onClick={toggle}
      aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
      title={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
    >
      {theme === "dark" ? "☾" : "☀"}
    </button>
  );
}
