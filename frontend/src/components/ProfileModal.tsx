"use client";

import { useMemo, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { fetchNameKatakanaOptions, importGoogleMapsList, type NameKatakanaOption } from "@/lib/api";
import {
  DEFAULT_PROFILE,
  DEFAULT_TTS_VOICE,
  getServerProfileSnapshot,
  JAPANESE_TTS_VOICES,
  loadTravelerProfile,
  profileWesternFullName,
  saveTravelerProfile,
  subscribeTravelerProfile,
  type TravelerProfile
} from "@/lib/profile";

export type ProfileModalSection = "profile" | "voice" | "trip" | "places";

type Props = {
  open: boolean;
  section: ProfileModalSection;
  defaultName: string;
  onClose: () => void;
  onChangeSection: (section: ProfileModalSection) => void;
  userId?: string;
};

const SECTIONS: { id: ProfileModalSection; label: string; description: string }[] = [
  { id: "profile", label: "Profile", description: "Name and how Japanese speakers should read it." },
  { id: "voice", label: "Personalization", description: "Voice, transcript polish, and how the translator behaves around you." },
  { id: "trip", label: "Trip", description: "Travel context — hotel, who you're with, dietary needs." },
  { id: "places", label: "Places", description: "Saved spots imported from Google Maps lists." }
];

const SAVED_PILL_MS = 1400;

export function ProfileModal({ open, section, defaultName, onClose, onChangeSection, userId }: Props) {
  const profile = useSyncExternalStore(
    subscribeTravelerProfile,
    loadTravelerProfile,
    getServerProfileSnapshot
  );

  const [savedVisible, setSavedVisible] = useState(false);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function flashSaved() {
    if (savedTimer.current) clearTimeout(savedTimer.current);
    setSavedVisible(true);
    savedTimer.current = setTimeout(() => setSavedVisible(false), SAVED_PILL_MS + 50);
  }

  function commit(patch: Partial<TravelerProfile>) {
    const next = { ...profile, ...patch };
    saveTravelerProfile(next);
    flashSaved();
  }

  function onBackdrop(event: React.MouseEvent) {
    if (event.target === event.currentTarget) onClose();
  }

  function onKeyDown(event: React.KeyboardEvent) {
    if (event.key === "Escape") onClose();
  }

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div
      className="profileModalBackdrop"
      onClick={onBackdrop}
      onKeyDown={onKeyDown}
      role="presentation"
    >
      <div
        className="profileModalDialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="profileModalTitle"
      >
        <nav className="profileModalNav" aria-label="Profile sections">
          <button
            type="button"
            className="profileModalClose"
            onClick={onClose}
            aria-label="Close profile"
          >
            <CloseIcon />
          </button>
          <ul className="profileModalNavList">
            {SECTIONS.map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  className={`profileModalNavItem${section === s.id ? " profileModalNavItem--active" : ""}`}
                  onClick={() => onChangeSection(s.id)}
                  aria-current={section === s.id ? "page" : undefined}
                >
                  {s.label}
                </button>
              </li>
            ))}
          </ul>
        </nav>

        <section className="profileModalPane">
          <header className="profileModalPaneHeader">
            <div>
              <h2 className="profileModalTitle" id="profileModalTitle">
                {SECTIONS.find((s) => s.id === section)?.label ?? "Profile"}
              </h2>
              <p className="profileModalDescription">
                {SECTIONS.find((s) => s.id === section)?.description ?? ""}
              </p>
            </div>
            <span
              className={`profileSavedPill${savedVisible ? " profileSavedPill--on" : ""}`}
              role="status"
              aria-live="polite"
            >
              Saved
            </span>
          </header>

          <div className="profileModalPaneBody">
            {section === "profile" ? (
              <ProfileSection profile={profile} commit={commit} defaultName={defaultName} userId={userId} />
            ) : null}
            {section === "voice" ? <VoiceSection profile={profile} commit={commit} /> : null}
            {section === "trip" ? <TripSection profile={profile} commit={commit} /> : null}
            {section === "places" ? <PlacesSection profile={profile} commit={commit} userId={userId} /> : null}
          </div>
        </section>
      </div>
    </div>,
    document.body
  );
}

function ProfileSection({
  profile,
  commit,
  defaultName,
  userId
}: {
  profile: TravelerProfile;
  commit: (patch: Partial<TravelerProfile>) => void;
  defaultName: string;
  userId?: string;
}) {
  const [katakanaOptions, setKatakanaOptions] = useState<NameKatakanaOption[]>([]);
  const [katakanaLoading, setKatakanaLoading] = useState(false);
  const [katakanaError, setKatakanaError] = useState<string | null>(null);

  const namePlaceholder = useMemo(() => {
    const parts = defaultName.trim().split(/\s+/);
    return {
      first: parts[0] || "John",
      last: parts.slice(1).join(" ") || "Smith"
    };
  }, [defaultName]);

  async function suggestKatakana() {
    const full = profileWesternFullName(profile);
    if (!full) {
      setKatakanaError("Add your first or last name above first.");
      setKatakanaOptions([]);
      return;
    }
    setKatakanaLoading(true);
    setKatakanaError(null);
    try {
      const { options } = await fetchNameKatakanaOptions({
        first_name: profile.first_name,
        last_name: profile.last_name
      }, userId);
      setKatakanaOptions(options);
      if (!options.length) {
        setKatakanaError("No suggestions returned. Try again or type katakana yourself.");
      }
    } catch (e) {
      setKatakanaOptions([]);
      setKatakanaError(e instanceof Error ? e.message : "Could not load suggestions.");
    } finally {
      setKatakanaLoading(false);
    }
  }

  function optionMatches(opt: NameKatakanaOption) {
    return (
      profile.first_name_katakana.trim() === opt.first_katakana.trim() &&
      profile.last_name_katakana.trim() === opt.last_katakana.trim()
    );
  }

  function applyOption(opt: NameKatakanaOption) {
    commit({
      first_name_katakana: opt.first_katakana,
      last_name_katakana: opt.last_katakana
    });
  }

  return (
    <div className="profileFormStack">
      <p className="profileHelperText">
        Your name shows up here by default — change it if friends or hosts call you something different.
      </p>
      <div className="profileFieldRow">
        <DraftField
          label="First name"
          value={profile.first_name}
          placeholder={namePlaceholder.first}
          autoComplete="given-name"
          onCommit={(value) => commit({ first_name: value })}
        />
        <DraftField
          label="Last name"
          value={profile.last_name}
          placeholder={namePlaceholder.last}
          autoComplete="family-name"
          onCommit={(value) => commit({ last_name: value })}
        />
      </div>

      <div className="profileSubsection">
        <header className="profileSubsectionHeader">
          <div>
            <h3 className="profileSubsectionTitle" lang="ja">
              カタカナ <span lang="en">— Japanese reading</span>
            </h3>
            <p className="profileSubsectionHint">Helps Japanese speakers read your name out loud.</p>
          </div>
          <button
            type="button"
            className="secondaryButton profileSuggestButton"
            disabled={katakanaLoading || !profileWesternFullName(profile)}
            onClick={() => void suggestKatakana()}
          >
            {katakanaLoading ? (
              <>
                <Spinner />
                <span>Looking up</span>
              </>
            ) : (
              "Suggest"
            )}
          </button>
        </header>
        {katakanaError ? <p className="profileFieldError">{katakanaError}</p> : null}
        {katakanaOptions.length ? (
          <div className="profileKatakanaOptions" role="group" aria-label="Suggested katakana spellings">
            {katakanaOptions.map((opt) => (
              <button
                type="button"
                key={`${opt.first_katakana}|${opt.last_katakana}|${opt.first_reading_en}|${opt.last_reading_en}`}
                className={`profileKatakanaOption${optionMatches(opt) ? " active" : ""}`}
                onClick={() => applyOption(opt)}
              >
                <span className="profileKatakanaOptionNames">
                  <span className="profileKatakanaPart">
                    <span className="profileKatakanaPartLabel">First</span>
                    <span className="profileKatakanaPartValue" lang="ja">
                      {opt.first_katakana || "—"}
                    </span>
                    <span className="profileKatakanaReading" lang="en">
                      {opt.first_reading_en.trim() || "—"}
                    </span>
                  </span>
                  <span className="profileKatakanaPart">
                    <span className="profileKatakanaPartLabel">Last</span>
                    <span className="profileKatakanaPartValue" lang="ja">
                      {opt.last_katakana || "—"}
                    </span>
                    <span className="profileKatakanaReading" lang="en">
                      {opt.last_reading_en.trim() || "—"}
                    </span>
                  </span>
                </span>
              </button>
            ))}
          </div>
        ) : null}
        <div className="profileFieldRow">
          <DraftField
            label="First name (katakana)"
            value={profile.first_name_katakana}
            placeholder="ジョン"
            lang="ja"
            onCommit={(value) => commit({ first_name_katakana: value })}
          />
          <DraftField
            label="Last name (katakana)"
            value={profile.last_name_katakana}
            placeholder="スミス"
            lang="ja"
            onCommit={(value) => commit({ last_name_katakana: value })}
          />
        </div>
      </div>
    </div>
  );
}

function VoiceSection({
  profile,
  commit
}: {
  profile: TravelerProfile;
  commit: (patch: Partial<TravelerProfile>) => void;
}) {
  function select(id: string) {
    const voice = JAPANESE_TTS_VOICES.find((v) => v.id === id) ?? DEFAULT_TTS_VOICE;
    commit({ tts_voice_id: voice.id, tts_voice_name: voice.name });
  }
  return (
    <div className="profileFormStack">
      <ul className="profileVoiceList" role="radiogroup" aria-label="Japanese TTS voice">
        {JAPANESE_TTS_VOICES.map((voice) => {
          const active = profile.tts_voice_id === voice.id;
          return (
            <li key={voice.id}>
              <button
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => select(voice.id)}
                className={`profileVoiceRow${active ? " profileVoiceRow--active" : ""}`}
              >
                <span className="profileVoiceAvatar" aria-hidden>
                  <span lang="ja">{voice.kana.charAt(0)}</span>
                </span>
                <span className="profileVoiceBody">
                  <span className="profileVoiceName">
                    {voice.name}
                    <span className="profileVoiceKana" lang="ja">
                      {voice.kana}
                    </span>
                  </span>
                  <span className="profileVoiceDescription">{voice.description}</span>
                </span>
                <span
                  className={`profileVoiceCheck${active ? " profileVoiceCheck--on" : ""}`}
                  aria-hidden
                >
                  {active ? <CheckIcon /> : null}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      <p className="profileHelperText">
        Want to audition the voice?{" "}
        <a
          href={
            JAPANESE_TTS_VOICES.find((v) => v.id === profile.tts_voice_id)?.previewUrl ??
            JAPANESE_TTS_VOICES[0]!.previewUrl
          }
          target="_blank"
          rel="noreferrer noopener"
          className="profileExternalLink"
        >
          Preview on ElevenLabs ↗
        </a>
      </p>

      <div className="profileSubsection profileToggleRow">
        <div className="profileToggleRowText">
          <h3 className="profileSubsectionTitle">Auto-improve chats</h3>
          <p className="profileSubsectionHint">
            Two minutes after a chat stops, this quietly re-runs speaker labeling and re-translates the transcript with a higher-quality model. The polished version replaces the live one the next time you open the chat. Resuming the chat before the timer fires cancels it. Failed runs leave the chat untouched.
          </p>
        </div>
        <label className={`appleSwitch${profile.auto_improve ? " active" : ""}`} aria-label="Auto-improve chats">
          <input
            type="checkbox"
            checked={profile.auto_improve}
            onChange={(event) => commit({ auto_improve: event.target.checked })}
          />
          <span className="appleSwitchTrack" aria-hidden>
            <span />
          </span>
          <span>{profile.auto_improve ? "On" : "Off"}</span>
        </label>
      </div>
    </div>
  );
}

function TripSection({
  profile,
  commit
}: {
  profile: TravelerProfile;
  commit: (patch: Partial<TravelerProfile>) => void;
}) {
  return (
    <div className="profileFormStack">
      <div className="profileFieldRow">
        <DraftField
          label="Your age"
          value={profile.age}
          placeholder="34"
          onCommit={(value) => commit({ age: value })}
        />
        <DraftField
          label="Where are you staying?"
          value={profile.hotel}
          placeholder="Hotel name or neighborhood"
          onCommit={(value) => commit({ hotel: value })}
        />
      </div>
      <DraftField
        label="Who is with you?"
        value={profile.travel_party}
        placeholder="My wife Ana, my daughter Mia"
        onCommit={(value) => commit({ travel_party: value })}
      />
      <div className="profileFieldRow">
        <DraftField
          label="Food allergies or restrictions"
          value={profile.allergies}
          placeholder="peanuts, shrimp, vegetarian, no pork"
          onCommit={(value) => commit({ allergies: value })}
        />
        <DraftField
          label="Spice preference"
          value={profile.spice_level}
          placeholder="mild only, no wasabi"
          onCommit={(value) => commit({ spice_level: value })}
        />
      </div>
      <DraftField
        label="Mobility or luggage needs"
        value={profile.mobility}
        placeholder="need elevator, stroller, large suitcase"
        onCommit={(value) => commit({ mobility: value })}
      />
    </div>
  );
}

function PlacesSection({
  profile,
  commit,
  userId
}: {
  profile: TravelerProfile;
  commit: (patch: Partial<TravelerProfile>) => void;
  userId?: string;
}) {
  const [url, setUrl] = useState("");
  const [status, setStatus] = useState("");
  const [importing, setImporting] = useState(false);

  async function importList() {
    const trimmed = url.trim();
    if (!trimmed) {
      setStatus("Paste a shared Google Maps list link first.");
      return;
    }
    setImporting(true);
    setStatus("Importing shared list...");
    try {
      const result = await importGoogleMapsList({ url: trimmed }, userId);
      const placeLines = result.places.map((place) => {
        const details = [place.address].filter(Boolean).join(" · ");
        return details ? `${place.name} — ${details}` : place.name;
      });
      const nextPlaces = mergeLines(profile.saved_places, placeLines);
      commit({ saved_places: nextPlaces });
      setStatus(`Imported ${result.places.length} places${result.title ? ` from ${result.title}` : ""}.`);
      setUrl("");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not import that list.");
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="profileFormStack">
      <div className="profileMapsImport">
        <label className="contextField">
          Google Maps list link
          <input
            inputMode="url"
            placeholder="https://maps.app.goo.gl/..."
            value={url}
            onChange={(event) => setUrl(event.target.value)}
          />
        </label>
        <button
          type="button"
          className="secondaryButton"
          disabled={importing || !url.trim()}
          onClick={() => void importList()}
        >
          {importing ? (
            <>
              <Spinner />
              <span>Importing</span>
            </>
          ) : (
            "Import"
          )}
        </button>
      </div>
      {status ? <p className="profileHelperText">{status}</p> : null}
      <DraftTextarea
        label="Places to remember"
        value={profile.saved_places}
        placeholder="Kiyomizu-dera, Kyoto Station, favorite ramen shop..."
        onCommit={(value) => commit({ saved_places: value })}
      />
    </div>
  );
}

function DraftField({
  label,
  value,
  placeholder,
  lang,
  autoComplete,
  onCommit
}: {
  label: string;
  value: string;
  placeholder?: string;
  lang?: string;
  autoComplete?: string;
  onCommit: (next: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  const [seen, setSeen] = useState(value);
  if (value !== seen) {
    setSeen(value);
    setDraft(value);
  }
  function commit() {
    const next = draft.trim();
    if (next !== value.trim()) onCommit(next);
  }
  return (
    <label className="contextField">
      {label}
      <input
        value={draft}
        placeholder={placeholder}
        lang={lang}
        autoComplete={autoComplete}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            (event.target as HTMLInputElement).blur();
          }
        }}
      />
    </label>
  );
}

function DraftTextarea({
  label,
  value,
  placeholder,
  onCommit
}: {
  label: string;
  value: string;
  placeholder?: string;
  onCommit: (next: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  const [seen, setSeen] = useState(value);
  if (value !== seen) {
    setSeen(value);
    setDraft(value);
  }
  function commit() {
    if (draft !== value) onCommit(draft);
  }
  return (
    <label className="contextField">
      {label}
      <textarea
        value={draft}
        placeholder={placeholder}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
      />
    </label>
  );
}

function mergeLines(current: string, additions: string[]): string {
  const seen = new Set<string>();
  return [...current.split(/\r?\n/), ...additions]
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => {
      const key = line.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .join("\n");
}

function CloseIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path d="M4 4L12 12M12 4L4 12" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        d="M3.5 8.5L6.5 11.5L12.5 5"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function Spinner() {
  return <span className="profileSpinner" aria-hidden />;
}

// Suppress unused-import warning while ESM-style export keeps DEFAULT_PROFILE typing safe.
void DEFAULT_PROFILE;
