"use client";

import { createContext, useCallback, useContext, useMemo, useSyncExternalStore } from "react";
import { DEFAULT_LOCALE, Locale, messages, type Messages } from "./messages";

const STORAGE_KEY = "cottonoha-locale";
const LOCALE_CHANGE_EVENT = "cottonoha:locale-change";

interface LocaleContextValue {
  locale: Locale;
  setLocale: (l: Locale) => void;
  toggleLocale: () => void;
  t: Messages;
}

const LocaleContext = createContext<LocaleContextValue | null>(null);

function readStoredLocale(): Locale {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === "ja" || stored === "en") return stored;
  } catch {
    // localStorage unavailable
  }
  return DEFAULT_LOCALE;
}

function subscribeLocale(notify: () => void): () => void {
  window.addEventListener(LOCALE_CHANGE_EVENT, notify);
  window.addEventListener("storage", notify);
  return () => {
    window.removeEventListener(LOCALE_CHANGE_EVENT, notify);
    window.removeEventListener("storage", notify);
  };
}

function persistLocale(l: Locale): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, l);
  } catch {
    // localStorage unavailable
  }
  if (typeof document !== "undefined") {
    document.documentElement.lang = l;
  }
  window.dispatchEvent(new Event(LOCALE_CHANGE_EVENT));
}

export function LocaleProvider({ children }: { children: React.ReactNode }) {
  const locale = useSyncExternalStore(subscribeLocale, readStoredLocale, () => DEFAULT_LOCALE);

  const setLocale = useCallback((l: Locale) => {
    persistLocale(l);
  }, []);

  const toggleLocale = useCallback(() => {
    persistLocale(locale === "ja" ? "en" : "ja");
  }, [locale]);

  const value = useMemo<LocaleContextValue>(
    () => ({ locale, setLocale, toggleLocale, t: messages[locale] }),
    [locale, setLocale, toggleLocale]
  );

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useLocale(): LocaleContextValue {
  const ctx = useContext(LocaleContext);
  if (!ctx) {
    throw new Error("useLocale must be used within LocaleProvider");
  }
  return ctx;
}
