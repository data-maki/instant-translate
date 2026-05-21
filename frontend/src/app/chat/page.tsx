import { TranslatorAppClient } from "@/components/TranslatorAppClient";
import { fetchLanguages, fetchSessions, Language, SessionSummary } from "@/lib/api";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";
const INITIAL_SESSION_LIMIT = 8;

export default async function ChatPage() {
  const session = await auth.api.getSession({
    headers: await headers()
  });

  if (!session) {
    redirect("/sign-in?next=/chat");
  }

  const userId = session.user.id;
  const userName = session.user.name || session.user.email || "";
  // The BetterAuth bearer plugin makes this token usable as
  // `Authorization: Bearer <token>` against any service that calls
  // /api/auth/get-session to validate it. We forward it to the FastAPI
  // backend instead of letting the client claim an identity.
  const authToken = session.session.token;
  let initialLanguages: Language[] = [];
  let initialSourceLanguages = ["ja"];
  let initialTargetLanguage = "en";
  let initialSessions: SessionSummary[] = [];
  let initialSessionTotal = 0;
  let initialLoadError = "";

  try {
    const [languageResult, sessionResult] = await Promise.all([
      fetchLanguages(),
      fetchSessions({ limit: INITIAL_SESSION_LIMIT, userId: authToken })
    ]);
    initialLanguages = languageResult.languages;
    initialSourceLanguages = languageResult.default_source_languages;
    initialTargetLanguage = languageResult.default_target_language;
    initialSessions = sessionResult.sessions;
    initialSessionTotal = sessionResult.total;
  } catch (error) {
    initialLoadError = error instanceof Error ? error.message : "Could not load backend data.";
  }

  return (
    <TranslatorAppClient
      initialLanguages={initialLanguages}
      initialLoadError={initialLoadError}
      initialSessionTotal={initialSessionTotal}
      initialSessions={initialSessions}
      initialSourceLanguages={initialSourceLanguages}
      initialTargetLanguage={initialTargetLanguage}
      userId={authToken}
      userName={userName}
    />
  );
}
