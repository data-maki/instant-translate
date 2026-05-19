"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { fetchNameKatakanaOptions, importGoogleMapsList, type NameKatakanaOption } from "@/lib/api";
import {
  DEFAULT_PROFILE,
  loadTravelerProfile,
  profileWesternFullName,
  saveTravelerProfile,
  TravelerProfile
} from "@/lib/profile";

const PROFILE_FIELDS: {
  key: keyof TravelerProfile;
  label: string;
  placeholder: string;
  multiline?: boolean;
}[] = [
  {
    key: "age",
    label: "Your age",
    placeholder: "34"
  },
  {
    key: "hotel",
    label: "Where are you staying?",
    placeholder: "Hotel name or neighborhood"
  },
  {
    key: "travel_party",
    label: "Who is with you?",
    placeholder: "My wife Ana, my daughter Mia"
  },
  {
    key: "allergies",
    label: "Food allergies or restrictions",
    placeholder: "peanuts, shrimp, vegetarian, no pork"
  },
  {
    key: "spice_level",
    label: "Spice preference",
    placeholder: "mild only, no wasabi"
  },
  {
    key: "mobility",
    label: "Mobility or luggage needs",
    placeholder: "need elevator, stroller, large suitcase"
  }
];

const SAVE_ACK_MS = 2200;

export function ProfileApp() {
  const [profile, setProfile] = useState<TravelerProfile>(() => loadTravelerProfile());
  const [saveStatus, setSaveStatus] = useState("Saved in this browser");
  const [saveAck, setSaveAck] = useState(false);
  const saveAckTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [katakanaOptions, setKatakanaOptions] = useState<NameKatakanaOption[]>([]);
  const [katakanaLoading, setKatakanaLoading] = useState(false);
  const [katakanaError, setKatakanaError] = useState<string | null>(null);
  const [mapsListUrl, setMapsListUrl] = useState("");
  const [mapsImportStatus, setMapsImportStatus] = useState("");
  const [mapsImporting, setMapsImporting] = useState(false);

  function clearSaveAck() {
    if (saveAckTimer.current) {
      clearTimeout(saveAckTimer.current);
      saveAckTimer.current = null;
    }
    setSaveAck(false);
  }

  function flashExplicitSave() {
    clearSaveAck();
    setSaveAck(true);
    saveAckTimer.current = setTimeout(() => {
      setSaveAck(false);
      saveAckTimer.current = null;
    }, SAVE_ACK_MS);
  }

  function updateProfile(key: keyof TravelerProfile, value: string) {
    const next = { ...profile, [key]: value };
    setProfile(next);
    saveTravelerProfile(next);
    clearSaveAck();
    setSaveStatus("Saved in this browser");
  }

  function saveProfile() {
    saveTravelerProfile(profile);
    clearSaveAck();
    setSaveStatus("Saved in this browser");
    flashExplicitSave();
  }

  function resetProfile() {
    clearSaveAck();
    setProfile(DEFAULT_PROFILE);
    saveTravelerProfile(DEFAULT_PROFILE);
    setSaveStatus("Profile cleared");
    setKatakanaOptions([]);
    setKatakanaError(null);
  }

  function applyKatakanaOption(opt: NameKatakanaOption) {
    const next = {
      ...profile,
      first_name_katakana: opt.first_katakana,
      last_name_katakana: opt.last_katakana
    };
    setProfile(next);
    saveTravelerProfile(next);
    clearSaveAck();
    setSaveStatus("Saved in this browser");
  }

  function katakanaOptionKey(opt: NameKatakanaOption) {
    return `${opt.first_katakana}\n${opt.last_katakana}\n${opt.first_reading_en}\n${opt.last_reading_en}`;
  }

  function optionMatchesProfile(opt: NameKatakanaOption) {
    return (
      profile.first_name_katakana.trim() === opt.first_katakana.trim() &&
      profile.last_name_katakana.trim() === opt.last_katakana.trim()
    );
  }

  async function suggestKatakana() {
    const full = profileWesternFullName(profile);
    if (!full) {
      setKatakanaError("Add a first or last name first.");
      setKatakanaOptions([]);
      return;
    }
    setKatakanaLoading(true);
    setKatakanaError(null);
    try {
      const { options } = await fetchNameKatakanaOptions({
        first_name: profile.first_name,
        last_name: profile.last_name
      });
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

  async function importSavedPlaces() {
    const url = mapsListUrl.trim();
    if (!url) {
      setMapsImportStatus("Paste a shared Google Maps list link first.");
      return;
    }
    setMapsImporting(true);
    setMapsImportStatus("Importing shared list...");
    try {
      const result = await importGoogleMapsList({ url });
      const placeLines = result.places.map((place) => {
        const details = [place.address].filter(Boolean).join(" · ");
        return details ? `${place.name} — ${details}` : place.name;
      });
      const nextPlaces = mergeLines(profile.saved_places, placeLines);
      const next = { ...profile, saved_places: nextPlaces };
      setProfile(next);
      saveTravelerProfile(next);
      clearSaveAck();
      setSaveStatus("Saved in this browser");
      setMapsImportStatus(`Imported ${result.places.length} places${result.title ? ` from ${result.title}` : ""}.`);
    } catch (error) {
      setMapsImportStatus(error instanceof Error ? error.message : "Could not import that list.");
    } finally {
      setMapsImporting(false);
    }
  }

  return (
    <main className="profilePage">
      <header className="profileHeader">
        <div>
          <p className="panelKicker">profile</p>
          <h1>Reusable context</h1>
        </div>
        <Link className="secondaryButton profileBackLink" href="/">
          Back to translator
        </Link>
      </header>

      <section className="profileEditor" aria-label="Traveler profile">
        <div className="profileIntro">
          <h2>Things that should follow you between conversations</h2>
          <p>
            Answer ordinary travel questions here. The app turns them into names, places, and glossary hints behind the
            scenes.
          </p>
        </div>

        <div className="profileGrid">
          <div className="profileNameBlock">
            <div className="profileNamePair">
              <label className="contextField">
                First name
                <input
                  onChange={(event) => updateProfile("first_name", event.target.value)}
                  placeholder="John"
                  value={profile.first_name}
                  autoComplete="given-name"
                />
              </label>
              <label className="contextField">
                Last name
                <input
                  onChange={(event) => updateProfile("last_name", event.target.value)}
                  placeholder="Smith"
                  value={profile.last_name}
                  autoComplete="family-name"
                />
              </label>
            </div>
            <div className="profileKatakana">
              <div className="profileKatakanaHeader">
                <span className="profileKatakanaLabel">Japanese katakana (by name)</span>
                <button
                  className="secondaryButton profileKatakanaSuggest"
                  disabled={katakanaLoading || !profileWesternFullName(profile)}
                  onClick={() => void suggestKatakana()}
                  type="button"
                >
                  {katakanaLoading ? "Looking up…" : "Suggest katakana"}
                </button>
              </div>
              {katakanaError ? <p className="profileKatakanaError">{katakanaError}</p> : null}
              {katakanaOptions.length ? (
                <div className="profileKatakanaOptions" role="group" aria-label="Pick katakana spellings">
                  {katakanaOptions.map((opt) => (
                    <button
                      className={`profileKatakanaOption ${optionMatchesProfile(opt) ? "active" : ""}`}
                      key={katakanaOptionKey(opt)}
                      onClick={() => applyKatakanaOption(opt)}
                      type="button"
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
              <div className="profileKatakanaManualPair">
                <label className="contextField profileKatakanaManual">
                  First name (katakana)
                  <input
                    onChange={(event) => updateProfile("first_name_katakana", event.target.value)}
                    placeholder="ジョン"
                    value={profile.first_name_katakana}
                    lang="ja"
                  />
                </label>
                <label className="contextField profileKatakanaManual">
                  Last name (katakana)
                  <input
                    onChange={(event) => updateProfile("last_name_katakana", event.target.value)}
                    placeholder="スミス"
                    value={profile.last_name_katakana}
                    lang="ja"
                  />
                </label>
              </div>
              <p className="profileKatakanaLatinHint">
                Latin names for reference:{" "}
                <strong>
                  {[profile.first_name, profile.last_name].map((s) => s.trim()).filter(Boolean).join(" ") || "—"}
                </strong>
              </p>
            </div>
          </div>

          {PROFILE_FIELDS.map((field) => (
            <label className="contextField" key={field.key}>
              {field.label}
              {field.multiline ? (
                <textarea
                  onChange={(event) => updateProfile(field.key, event.target.value)}
                  placeholder={field.placeholder}
                  value={profile[field.key]}
                />
              ) : (
                <input
                  onChange={(event) => updateProfile(field.key, event.target.value)}
                  placeholder={field.placeholder}
                  value={profile[field.key]}
                />
              )}
            </label>
          ))}

          <section className="profilePlacesBlock" aria-label="Saved Google Maps places">
            <div className="profilePlacesHeader">
              <div>
                <h3>Saved places</h3>
                <p>Paste a shared Google Maps list link. Imported names become reusable travel context.</p>
              </div>
            </div>
            <div className="profileMapsImport">
              <label className="contextField">
                Google Maps list link
                <input
                  onChange={(event) => setMapsListUrl(event.target.value)}
                  placeholder="https://maps.app.goo.gl/..."
                  value={mapsListUrl}
                  inputMode="url"
                />
              </label>
              <button className="secondaryButton" disabled={mapsImporting || !mapsListUrl.trim()} onClick={() => void importSavedPlaces()} type="button">
                {mapsImporting ? "Importing..." : "Import list"}
              </button>
            </div>
            {mapsImportStatus ? <p className="hint">{mapsImportStatus}</p> : null}
            <label className="contextField">
              Places to remember
              <textarea
                onChange={(event) => updateProfile("saved_places", event.target.value)}
                placeholder="Kiyomizu-dera, Kyoto Station, favorite ramen shop..."
                value={profile.saved_places}
              />
            </label>
          </section>
        </div>

        <div className="profileActions">
          <span
            className={`hint profileSaveHint${saveAck ? " profileSaveHint--ack" : ""}`}
            role="status"
            aria-live="polite"
          >
            {saveAck ? "Profile saved in this browser." : saveStatus}
          </span>
          <button
            className={`primaryButton${saveAck ? " primaryButton--savedAck" : ""}`}
            onClick={saveProfile}
            type="button"
          >
            {saveAck ? "Saved" : "Save profile"}
          </button>
          <button className="secondaryButton" onClick={resetProfile} type="button">
            Clear profile
          </button>
        </div>
      </section>
    </main>
  );
}

function mergeLines(current: string, additions: string[]): string {
  const seen = new Set<string>();
  const lines = [...current.split(/\r?\n/), ...additions]
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => {
      const key = line.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  return lines.join("\n");
}
