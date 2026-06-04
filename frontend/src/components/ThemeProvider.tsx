"use client";

import { createContext, useContext, useLayoutEffect, useMemo, useState, useSyncExternalStore } from "react";
import {
  loadThemePreference,
  resolveTheme,
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

function subscribeSystemTheme(onStoreChange: () => void): () => void {
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  mq.addEventListener("change", onStoreChange);
  return () => mq.removeEventListener("change", onStoreChange);
}

function getSystemThemeSnapshot(): ResolvedTheme {
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [preference, setPreferenceState] = useState<ThemePreference>("system");
  const systemTheme = useSyncExternalStore(subscribeSystemTheme, getSystemThemeSnapshot, () => "light" as ResolvedTheme);

  useLayoutEffect(() => {
    setPreferenceState(loadThemePreference());
  }, []);

  const resolved: ResolvedTheme =
    preference === "system" ? systemTheme : preference === "dark" ? "dark" : "light";

  useLayoutEffect(() => {
    const root = document.documentElement;
    root.classList.remove("theme-light", "theme-dark");
    root.classList.add(themeClass(resolved));
  }, [resolved]);

  const value = useMemo(
    () => ({
      preference,
      resolved,
      setPreference(next: ThemePreference) {
        setPreferenceState(next);
        saveThemePreference(next);
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
