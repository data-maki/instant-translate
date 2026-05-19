import { TranslatorAppClient } from "@/components/TranslatorAppClient";
import { fetchLanguages, fetchSessions, Language, SessionSummary } from "@/lib/api";

export const dynamic = "force-dynamic";

export default async function Home() {
  let initialLanguages: Language[] = [];
  let initialSourceLanguages = ["ja"];
  let initialTargetLanguage = "en";
  let initialSessions: SessionSummary[] = [];
  let initialLoadError = "";

  try {
    const [languageResult, sessionResult] = await Promise.all([fetchLanguages(), fetchSessions()]);
    initialLanguages = languageResult.languages;
    initialSourceLanguages = languageResult.default_source_languages;
    initialTargetLanguage = languageResult.default_target_language;
    initialSessions = sessionResult.sessions;
  } catch (error) {
    initialLoadError = error instanceof Error ? error.message : "Could not load backend data.";
  }

  return (
    <TranslatorAppClient
      initialLanguages={initialLanguages}
      initialLoadError={initialLoadError}
      initialSessions={initialSessions}
      initialSourceLanguages={initialSourceLanguages}
      initialTargetLanguage={initialTargetLanguage}
    />
  );
}
