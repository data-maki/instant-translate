"use client";

import { useLocale } from "@/i18n/LocaleProvider";

export function LocaleToggle() {
  const { locale, setLocale, t } = useLocale();
  return (
    <div className="localeToggle" role="group" aria-label={t.landing.toggle.aria}>
      <button
        type="button"
        className={locale === "ja" ? "active" : ""}
        onClick={() => setLocale("ja")}
        aria-pressed={locale === "ja"}
        lang="ja"
      >
        {t.landing.toggle.ja}
      </button>
      <button
        type="button"
        className={locale === "en" ? "active" : ""}
        onClick={() => setLocale("en")}
        aria-pressed={locale === "en"}
        lang="en"
      >
        {t.landing.toggle.en}
      </button>
    </div>
  );
}
