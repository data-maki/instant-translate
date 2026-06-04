"use client";

import { useTheme } from "@/components/ThemeProvider";
import type { ThemePreference } from "@/lib/theme";

const ORDER: ThemePreference[] = ["system", "light", "dark"];

const LABELS: Record<ThemePreference, string> = {
  system: "System",
  light: "Light",
  dark: "Dark"
};

type Props = {
  className?: string;
  compact?: boolean;
};

export function ThemeToggle({ className = "", compact = false }: Props) {
  const { preference, setPreference } = useTheme();

  function cycle() {
    const index = ORDER.indexOf(preference);
    setPreference(ORDER[(index + 1) % ORDER.length]!);
  }

  return (
    <button
      type="button"
      className={`themeToggle${compact ? " themeToggle--compact" : ""}${className ? ` ${className}` : ""}`}
      onClick={cycle}
      title={`Theme: ${LABELS[preference]}. Click to change.`}
      aria-label={`Theme: ${LABELS[preference]}. Click to cycle system, light, or dark.`}
    >
      <ThemeIcon preference={preference} />
      {compact ? null : <span className="themeToggleLabel">{LABELS[preference]}</span>}
    </button>
  );
}

function ThemeIcon({ preference }: { preference: ThemePreference }) {
  if (preference === "dark") {
    return (
      <svg width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden>
        <path
          d="M10 3.5a6.5 6.5 0 1 0 6.5 6.5 4.8 4.8 0 0 1-6.5-6.5Z"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinejoin="round"
        />
      </svg>
    );
  }
  if (preference === "light") {
    return (
      <svg width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden>
        <circle cx="10" cy="10" r="3.5" stroke="currentColor" strokeWidth="1.6" />
        <path d="M10 2v2M10 16v2M3.05 3.05l1.41 1.41M15.54 15.54l1.41 1.41M2 10h2M16 10h2M3.05 16.95l1.41-1.41M15.54 4.46l1.41-1.41" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
    );
  }
  return (
    <svg width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden>
      <rect x="3" y="4" width="14" height="11" rx="2" stroke="currentColor" strokeWidth="1.6" />
      <path d="M7 16h6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}
