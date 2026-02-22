"use client";

import { useTheme } from "./ThemeProvider";

export const ThemeToggle = () => {
  const { theme, toggleTheme } = useTheme();

  return (
    <button
      onClick={toggleTheme}
      aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
      className="btn-secondary p-2 rounded-xl"
    >
      <svg
        className="theme-icon-sun"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        width="20"
        height="20"
        aria-hidden="true"
      >
        <circle cx="12" cy="12" r="4" strokeWidth="2" />
        <path
          strokeLinecap="round"
          strokeWidth="2"
          d="M12 2v2m0 16v2M4.93 4.93l1.41 1.41m11.32 11.32l1.41 1.41M2 12h2m16 0h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"
        />
      </svg>
      <svg
        className="theme-icon-moon"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        width="20"
        height="20"
        aria-hidden="true"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2"
          d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z"
        />
      </svg>
    </button>
  );
};
