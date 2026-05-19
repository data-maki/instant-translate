# Context And Glossary Research Goal

This is a research goal, not an implementation plan. The goal is to decide whether better Soniox context construction can measurably improve live transcription and translation quality without bloating the prompt or creating a confusing setup flow for non-technical travelers.

The current app path is:

```text
Browser session setup
  -> user edits a free-text context field
  -> frontend appends hidden Japanese register block
  -> backend/app/soniox.py sends Soniox realtime context as:
       { "context": { "text": "<combined free text>" } }
  -> Soniox realtime stt-rt-v4 returns transcript + two-way translation
  -> Improve transcript can later run Soniox async + GPT-4o revision
```

Soniox now supports structured context sections: `general`, `text`, `terms`, and `translation_terms`, with an 8,000-token maximum. That means this repo should evaluate context as a constrained ranking problem, not as "stuff everything into one text field."

Current baseline caveat: `frontend/src/components/TranslatorApp.tsx` stores the user-facing instruction string as `BASE_CONTEXT`, not just as a placeholder. If the user does not replace it, the app can send "Add useful context..." as part of the Soniox context. The research baseline should measure this honestly, then test a cleaner empty-default or structured-default variant.

## Research Objective

Find the smallest context bundle that improves user-visible translation quality per injected token.

Primary target:

```text
Maximize:
  critical-term accuracy + translation-term accuracy + meaning/naturalness score

Subject to:
  no WER regression on ordinary words
  no false-positive glossary hallucination
  context <= 2,000 tokens for MVP default
  context <= 8,000 Soniox hard limit in all cases
  setup remains usable by non-technical travelers
```

The 80/20 bet is that the biggest lift will come from:

1. Structured `general` context for setting, relationship, location, and task.
2. A short high-confidence `terms` list for names, places, foods, itinerary items, products, and culturally specific words.
3. A smaller `translation_terms` list only for terms where the preferred target-language rendering matters.
4. Date/time/location metadata when it changes likely vocabulary.
5. A persistent traveler profile for preferences that should silently bias future sessions.

## Why This Is Plausible

Soniox explicitly frames context as improving both transcription and translation accuracy, and separates broad metadata, background text, transcription terms, and translation terms. Their own guidance says `general` should stay short, `terms` should carry important words and names, `text` is less influential, and `translation_terms` should be reserved for translation preferences.

Other ASR systems point in the same direction:

- Google Speech adaptation targets rare words, frequent phrases, noisy audio, homophones, class-like concepts such as addresses, and warns that stronger bias can create false positives.
- Amazon Transcribe custom vocabulary examples show the exact class of travel errors we care about: proper nouns and landmarks. Their Hinglish travel-call example reduced WER from 9.848% to 6.061% by correcting place names.
- Date/time/location-aware RNN-T research reports up to 3.48% relative WER improvement from individual context, 4.62% from combined context, and up to 11.5% in specific domains.
- MT glossary products and terminology-aware MT papers show that terminology consistency is a downstream translation problem, not just an ASR problem. Translation glossaries are useful for named entities, ambiguous words, borrowed words, and domain-specific terms.

The product lesson from "AI Horseless Carriages" is also relevant: do not just bolt an AI textbox onto the old UI. The useful product should let the user teach the app durable preferences once, then automatically transform location, itinerary, and profile context into the right structured Soniox payload.

## Hypotheses

### H1: Structured general context beats free text for baseline orientation

```text
Current:
  text: "Family dinner in Japan..."

Candidate:
  general:
    domain: Travel conversation
    setting: Restaurant in Kyoto
    relationship: Visitor speaking with older in-law
    task: Ask about food, timing, etiquette, and directions
    location: Kyoto, Japan
    date: 2026-05-19
```

Expected lift:

- Better language/register choices.
- Better diarization if speaker count and roles are included.
- Lower risk than long free-form context because metadata is compact.

Risk:

- Too much instruction-like metadata may compete with the user-entered situation.
- Need to verify Soniox realtime accepts the full structured context object in this repo's websocket payload, not only the older text-only shape.

### H2: Small curated terms lists produce most of the ASR lift

Good terms are high-likelihood and acoustically error-prone:

- People: `Yuko`, `Takahashi-san`, `Obaachan`.
- Places: `Arashiyama`, `Kiyomizu-dera`, `Nishiki Market`.
- Food: `okonomiyaki`, `yuzu kosho`, `monjayaki`.
- Itinerary: hotel name, station name, restaurant name.
- Domain words: allergy names, transit terms, ticket names.

Bad terms are broad, generic, or unlikely:

- `restaurant`, `train`, `food`, `today`.
- Full dictionary dumps.
- Terms copied from every nearby map result.

Expected lift:

- Higher recall for proper nouns, menu items, place names, and names.
- Better display spelling/casing.

Risk:

- Large lists create distractors.
- False positives can hurt trust if the model inserts terms that were not spoken.

### H3: Translation terms should be sparse and preference-driven

`translation_terms` are for cases where translation choice matters:

```text
source: "辛口"
target: "spicy"

source: "お義母さん"
target: "mother-in-law"

source: "アレルギー"
target: "allergy"

source: "Yuko"
target: "Yuko"
```

Expected lift:

- More consistent names, relationship terms, allergies, and dish names.
- Less chance that culturally specific terms get over-translated.

Risk:

- Over-forcing can make translations unnatural.
- Some terms should remain untranslated in one direction but translated in the other, so the data model needs source/target/language direction.

### H4: Date, time, and location improve vocabulary selection

Silent metadata can bias expected vocabulary without user effort:

```text
general:
  location: Kyoto, Japan
  local_area: Nishiki Market
  date: 2026-05-19
  local_time: evening
  trip_phase: dinner planning
```

Expected lift:

- Better recognition of nearby landmarks, stations, restaurants, festivals, seasons, and time expressions.
- Better translations for context-dependent words like "fair/fare", "bus", "platform", "reservation", or local food words.

Risk:

- Location can be stale or too broad.
- Nearby term expansion must be capped aggressively.

### H5: A persistent traveler profile improves usefulness more than one-off prompts

Profile fields should be concrete and stable:

```text
traveler_profile:
  dietary:
    allergies: shrimp, peanuts
    restrictions: no pork
    spice_level: mild
  language:
    native_language: English
    learning_language: Japanese
    prefers_romaji: true
  style:
    translation_detail: concise
    politeness: polite neutral
  relationships:
    mother_in_law_name: Yuko
    partner_name: Aiko
  travel:
    hotel_area: Shinjuku
    current_city: Tokyo
```

Expected lift:

- The app can surface and inject context the user would forget to type.
- Better translation of food, family relationship, and preference-sensitive phrases.
- Less setup burden for non-technical users.

Risk:

- Sensitive profile data must be user-visible and editable.
- Stale profile data can be worse than no data, especially location and restrictions.

## Candidate Context Budget

Soniox hard limit: 8,000 tokens, roughly 10,000 characters.

MVP target: stay under 2,000 tokens unless the user explicitly attaches richer context.

Current default context budget estimate:

| Existing piece | Approx size | Keep? | Reason |
|---|---:|---|---|
| `BASE_CONTEXT` instruction string | ~20 words | No, if unchanged | It instructs the user, not Soniox |
| Hidden Japanese register block | ~55-75 words | Maybe, but structure it | Useful register signal, currently buried in `text` |
| User-entered session context | variable | Yes | Highest precision signal |

This leaves most of the MVP budget unused. The goal is not to fill it; the goal is to reserve space for high-signal context and reject low-confidence filler.

Default allocation:

| Section | Target | Max | Notes |
|---|---:|---:|---|
| `general` | 10 items | 15 items | Short key/value facts only |
| `terms` | 20 terms | 60 terms | Rank by likelihood and importance |
| `translation_terms` | 5 pairs | 20 pairs | Only true preferences/ambiguities |
| `text` | 200 words | 800 words | Use only for itinerary/menu/user notes |
| Hidden register block | current size | current size | Convert to structured metadata if possible |

Ranking formula:

```text
term_score =
  3.0 * user_entered
  + 2.5 * appears_in_itinerary
  + 2.0 * current_location_relevance
  + 2.0 * domain_importance
  + 1.5 * rare_or_non_English
  + 1.0 * recent_session_reuse
  - 2.0 * generic_word
  - 2.0 * stale_location
  - 3.0 * low_confidence_autogenerated
```

Only inject the top-ranked terms after de-duplication and stopword removal.

## Evaluation Metric

Use a composite score because "translation quality" has several failure modes.

```text
Context Quality Lift =
  0.30 * critical_term_recall_lift
  + 0.20 * critical_term_precision_lift
  + 0.20 * translation_term_accuracy_lift
  + 0.20 * human_or_llm_meaning_score_lift
  + 0.10 * human_or_llm_naturalness_score_lift
  - 0.20 * ordinary_word_WER_regression
  - 0.20 * false_positive_term_rate
```

Report both absolute score and lift over baseline:

```text
baseline: current free-text context
variant A: structured general only
variant B: general + 20 terms
variant C: general + 20 terms + 5 translation_terms
variant D: C + date/location
variant E: D + persistent traveler profile
```

Non-regression gates:

- Ordinary-word WER must not worsen by more than 1% relative.
- False-positive term rate must stay below 2% of injected terms per session.
- Translation meaning score must not decrease.
- Context must stay under the chosen budget.
- Setup flow must not require users to understand "glossary", "ASR", "MT", or "tokens".

## Fixture Design

Use saved local sessions under `output/<session>/` as the source of truth.

Minimum fixture set:

| Fixture type | Why |
|---|---|
| Japanese board game sessions | Proper nouns, rules vocabulary, multiple speakers |
| Food/restaurant session | Allergies, menu items, preference phrasing |
| Transit/location session | Stations, landmarks, time/place references |
| Family/in-law session | Relationship terms, register, names |
| Negative-control ordinary conversation | Detect glossary over-bias and false positives |

For each fixture, create:

- `baseline_context.json`: current context construction.
- `variant_contexts/*.json`: structured alternatives.
- `expected_terms.tsv`: source term, target term, required/optional, language direction.
- `human_reference.md`: small hand-labeled reference for critical segments only.
- `results.csv`: metrics by variant.

The research can start with critical segments instead of full transcripts. A five-minute hand-labeled set is enough to discover whether context is moving the right metric.

## Experiment Procedure

1. Freeze fixtures and references.
2. Compute the current context payload size.
3. Generate structured context variants with strict budgets.
4. Re-run Soniox async on saved MP3/WAV first, because it is repeatable and cheaper to compare than live streaming.
5. If async shows lift, run a live `stt-rt-v4` check on the best two context variants.
6. Score every variant on critical-term recall, term precision, translation-term accuracy, meaning, naturalness, WER regression, false positives, runtime, and cost.
7. Produce an improvement curve showing lift per added context section and lift per injected token.
8. Recommend the smallest winning context bundle.

## Product Shape For Non-Technical Users

The user should not manage a glossary table directly. The app should ask ordinary travel questions and compile Soniox context behind the scenes.

```text
Profile setup
  [Food] allergies, restrictions, spice level
  [Travel] city, hotel area, itinerary links/notes
  [People] names and relationships
  [Language] preferred translation style and politeness

Session start
  "What are you about to do?"
  [Restaurant] [Train] [Family] [Shopping] [Doctor] [Custom]

Generated Soniox context
  general: setting, location, relationship, task, date
  terms: top ranked names/places/foods/items
  translation_terms: sparse preferences
  text: short itinerary/menu/profile summary only when useful
```

The UI should expose "what will be used" in plain language:

```text
Context for this conversation

Using:
  - You are in Kyoto near Nishiki Market
  - You prefer mild spice
  - Allergy: shrimp
  - Names: Yuko, Aiko
  - Terms: yuzu kosho, okonomiyaki, Kiyomizu-dera

[Edit] [Start]
```

## Recommended First Research Slice

Simplest useful path:

```text
general only
  -> general + 20 terms
  -> general + 20 terms + 5 translation_terms
```

Best path:

```text
profile + location + session intent
  -> ranked context compiler
  -> Soniox structured context
  -> fixture-based lift curve
```

The simplest path is best for proving the metric. The best path is where the product should end up if the metrics show lift.

## Open Implementation Questions

- Does `stt-rt-v4` in the websocket path accept `context` as the structured object shown in current Soniox docs, or does this repo need separate handling for realtime and async?
- Should the frontend register block become structured `general` metadata instead of hidden free text?
- How should generated terms be stored: per profile, per trip, per session, or all three?
- Should automatic location terms require user confirmation before injection?
- Should translation preferences be directional for two-way translation?

## Decision Criteria

Integrate structured context only if the eval shows one of these:

- At least 10% relative lift in critical-term recall with no ordinary-word WER regression.
- At least 0.15 absolute lift in item-level translation meaning or naturalness score.
- At least 20% reduction in named-entity or place-name errors on travel fixtures.
- Clear qualitative win on high-stakes profile terms such as allergies, relationship terms, and named locations.

If all variants are flat, keep the current text field and only improve user copy. If terms help but profile/location does not, ship a small glossary/session-context compiler first and leave profile automation for later.

## Source Notes

- Soniox context docs: https://soniox.com/docs/stt/concepts/context
- Soniox Python SDK type docs for `StructuredContext`: https://soniox.com/docs/sdk/python-SDK/Full-SDK-reference/types
- Google Speech-to-Text model adaptation: https://docs.cloud.google.com/speech-to-text/docs/adaptation-model
- AWS Hinglish travel custom vocabulary example: https://aws.amazon.com/blogs/machine-learning/improve-transcription-accuracy-of-customer-agent-calls-with-custom-vocabulary-in-amazon-transcribe/
- Date/time/location-aware RNN-T paper: https://www.amazon.science/publications/improving-rnn-t-asr-performance-with-date-time-and-location-awareness
- Google Cloud Translation glossary docs: https://docs.cloud.google.com/translate/docs/advanced/glossary
- Bogoychev and Chen 2023 terminology-aware translation: https://aclanthology.org/2023.wmt-1.80/
- Pete Koomen, "AI Horseless Carriages": https://koomen.dev/essays/horseless-carriages/
