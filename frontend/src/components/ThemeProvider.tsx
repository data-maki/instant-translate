"use client";

import { createContext, useContext, useMemo, useState, useSyncExternalStore } from "react";
import {
  loadThemePreference,
  saveThemePreference,
  themeClass,
  type ResolvedTheme,
  type ThemePreference
} from "@/lib/theme";

type ThemeContextValue = {
  preference: ThemePreference;
  resolved: ResolvedTheme;
  setPreference: (preference: ThemePreference) => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

function applyThemeClass(resolved: ResolvedTheme): void {
  const root = document.documentElement;
  root.classList.remove("theme-light", "theme-dark");
  root.classList.add(themeClass(resolved));
}

function subscribeSystemTheme(onStoreChange: () => void): () => void {
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  function handleChange() {
    if (loadThemePreference() === "system") {
      applyThemeClass(getSystemThemeSnapshot());
    }
    onStoreChange();
  }
  mq.addEventListener("change", handleChange);
  return () => mq.removeEventListener("change", handleChange);
}

function getSystemThemeSnapshot(): ResolvedTheme {
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [preference, setPreferenceState] = useState<ThemePreference>(() => loadThemePreference());
  const systemTheme = useSyncExternalStore(subscribeSystemTheme, getSystemThemeSnapshot, () => "light" as ResolvedTheme);

  const resolved: ResolvedTheme =
    preference === "system" ? systemTheme : preference === "dark" ? "dark" : "light";

  const value = useMemo(
    () => ({
      preference,
      resolved,
      setPreference(next: ThemePreference) {
        setPreferenceState(next);
        saveThemePreference(next);
        applyThemeClass(next === "system" ? getSystemThemeSnapshot() : next);
      }
    }),
    [preference, resolved]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error("useTheme must be used within ThemeProvider");
  }
  return ctx;
}
