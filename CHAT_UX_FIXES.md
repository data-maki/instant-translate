# /chat — UX Fix Plan

Decisions for the 26 issues raised in the second-pass review of `/chat` (`frontend/src/components/TranslatorApp.tsx`).

## How to use this doc

Each issue lists three options and my recommendation. Mark your decision per issue and add a note if you want to override or scope the work differently. The bundle order at the bottom shows what to ship together.

- **Q** = quickest, ship-today minimum
- **M** = a bit more for clarity / polish
- **L** = textbook long-term answer

Rule of thumb (your instruction): **default to Q unless skipping the bigger fix bakes in a wrong shape that's hard to unwind later.** One-way doors are explicitly flagged where they exist.

---

## P0 — High impact

### 1. New chat chip vs session rows look like different species *(P0)*

The New chat button has a static bg + border by default; session rows are transparent until hover. Reads as two visual hierarchies for what should be one nav column.

- **Q** — Drop the static bg/border on `.newChatButton`; same default + hover as `.sessionButton`.
- **M** — Q + `+` icon and slightly heavier title weight so it still reads as the primary action.
- **L** — Move "+" next to the brand mark (Linear/Notion pattern), freeing the first row.

**My pick: M** — Q alone underweights it. L is a layout pivot, not necessary now.

**Your choice:** M.

**Notes:**

---

### 2. The `•••` menu splits each row into two clickable units *(P0)*

`.sessionMenuButton:hover` and `.sessionButton:hover` both paint borders, producing two adjacent bordered rects on one row.

- **Q** — Remove the menu's hover bg/border; treat the row as one unit.
- **M** — Q + show `•••` only on row hover (`opacity 0→1`).
- **L** — M + replace text `•••` with an SVG kebab icon and fade animation.

**My pick: M** — Show-on-row-hover is the ChatGPT pattern. Icon swap (#19) can ride along if convenient.

**Your choice:** M.

**Notes:**

---

### 3. Active session looks identical to a hovered session *(P0)*

`.sessionButton:hover` and `.sessionButton.active` apply the same styles. "You are here" reads as "I'm hovering".

- **Q** — Bold the active title + slightly tint the bg.
- **M** — Q + 2px left accent bar in brand red.
- **L** — M + animate the entry into active state.

**My pick: M** — The 2px bar is the convention and unambiguous after mouse-out.

**Your choice:** Q.

**Notes:**

---

### 4. `transition: all` evaluates to zero-duration; the UI snaps *(P0)*

23 interactive elements use the shorthand `transition: all` without a duration. Even where bg or border changes on hover, the change is instant. The UI feels dead.

- **Q** — One global rule on `button, a, [role="button"], input, ...` with named props + 150ms ease.
- **M** — Q + audit and remove per-element `transition: all` lines.
- **L** — M + motion design tokens (`--motion-fast`, `--motion-slow`) used app-wide.

**My pick: Q** — Single CSS block, massive feel improvement. Audit and tokens are bikeshedding unless multi-app.

**Your choice:** L.

**Notes:**

---

### 5. Audience and speaker chips have no hover feedback *(P0)*

Bg/border identical on default and hover. They look static, not clickable.

- **Q** — `:hover:not(.active)` → muted bg.
- **M** — Q + a 1px border color shift.
- **L** — M + scale/icon micro-transform.

**My pick: Q** — Bg-tint is the convention; rest is decoration.

**Your choice:** Q.

**Notes:**

---

### 6. Header H2 duplicates the language rail *(P0)*

`<h2>🇯🇵 Japanese → 🇬🇧 English</h2>` sits one row above the SPOKEN/TRANSLATE TO panel. Same data, two treatments.

- **Q** — Remove the H2 in setup mode; keep compact `JA→EN` in live mode header.
- **M** — Q + the compact pill is clickable (opens picker without scrolling to the rail).
- **L** — M + integrated mode-select dropdown in the same pill.

**My pick: Q** — Rail is the source of truth in setup; live header retains compact title via existing `transcriptTitleCompact`.

**Your choice:** Where will we be able to select languages? Do L (integrated mode-select dropdown).

**Notes:**

---

### 7. Setup form blocks all interaction before you can talk *(P0)*

Must pick audience + speakers + tone before "Start session" enables. High friction on the second visit.

- **Q** — Pre-fill audience/speakers from `localStorage` of the last session.
- **M** — Q + show a small "Last used: strangers · 2 speakers" line with a "Change" link.
- **L** — Skip setup entirely on returning visits — go straight into live mode with a small "Tweak setup" link.

**My pick: M** — Q is invisible; M makes the cached state legible. L is a real product call — discuss before doing.

**Your choice:** Don't do anything here. This is not needed. It's an overkill. The new chat should start with a clean slate, not prefilled with cached state. We can have a skeleton if useful but it's weird to show the skeleton when the chat is empty.

**Notes:**

---

## P1 — Medium impact

### 8. History is one flat list — no day groupings *(P1)*

`SessionGroup` type already exists in source but rendering is flat.

- **Q** — Bucket client-side by `updated`: Today / Yesterday / Previous 7 days / Older.
- **M** — Q + auto-collapse buckets older than 30 days.
- **L** — M + month dividers below "Older".

**My pick: Q** — Use the existing type; ship headers. Collapses are cosmetic.

**Your choice:** L. Chat / session history can be greatly improved.

**Notes:**

---

### 9. Profile + Sign out are twin boxed buttons *(P1, one-way door)*

Currently two same-sized buttons with form-control styling at the sidebar bottom. Misclick risk and missed identity affordance.

- **Q** — Tighten the existing styling (larger text, smaller borders).
- **M** — One avatar chip showing `user.name` → opens a small dropdown (Profile / Sign out).
- **L** — M + full menu with email, settings, theme, keyboard shortcuts.

**My pick: M** — One-way door: shipping a two-button bar now and switching to a menu later forces users to relearn. The avatar dropdown is the universal pattern and grows naturally as Settings exists. L promises empty doors (no Settings page yet).

**Your choice:** Q. Just make it look nicer. Sign out should be nested inside the profile page, not a first level item.

**Notes:**

---

### 10. "cottonoha" logo in the sidebar is not a link *(P1)*

No way back to landing from inside `/chat`.

- **Q** — Wrap in `<Link href="/">` + `aria-label="cottonoha, home"`.
- **M** — Q + subtle hover color.
- **L** — M + soft transition with reduced-motion fallback.

**My pick: M** — Trivial polish, matches the auth-card brand pattern already in place.

**Your choice:** M.
**Notes:**

---

### 11. No keyboard shortcuts *(P1)*

- **Q** — Cmd+J (new chat) + Esc (close drawer).
- **M** — Q + `?` overlay listing available shortcuts.
- **L** — M + Cmd+K focuses session search + Space toggles recording.

**My pick: Q** — Don't promise more than you ship. Grow with #12 and #15.

**Your choice:** No keyboard shortcuts. This is an overkill.

**Notes:**

---

### 12. No session search *(P1)*

- **Q** — Client-side `<input>` filter above the session list.
- **M** — Q + Cmd+K focuses it.
- **L** — Full Cmd+K command palette (sessions + actions).

**My pick: Q** — `<input>` + `.filter()` is ~10 lines. Palette territory is "are you Linear now?" — no.

**Your choice:** No need right now, this is an overkill.

**Notes:**

---

### 13. TONE triple-labels itself *(P1)*

"TONE" (kicker) + "Soft polite speech" (label) + "Tone: polite" (right-aligned) — same thing said three ways.

- **Q** — Single line: `Tone · Soft polite speech`. Drop the kicker and the right-aligned readout.
- **M** — Q + small "From: strangers" subline tying audience → tone (educational moment).
- **L** — M + click expands the override panel inline.

**My pick: M** — The cause→effect link is the explanation users actually want.

**Your choice:** M. But make sure not to overengineer / overdo this.

**Notes:**

---

### 14. "Tone override and optional note" mixes two scopes *(P1)*

Disclosure stuffs a DeepL formality dropdown and a free-text context note together.

- **Q** — Rename to "Add a note (optional)"; move the formality dropdown next to the Tone card.
- **M** — Q + move the note into the composer footer rather than a separate field.
- **L** — M + ML-suggested notes from context.

**My pick: Q** — Splitting the concerns is the fix. M overlaps with #15.

**Your choice:** We don't need the deepl formalities. Just thing about what's useful to the users to see and hide that is not.

**Notes:**

---

### 15. Composer hidden during setup *(P1)*

A user who wants to type a single phrase has to click through setup first. ChatGPT/Claude let you type immediately.

- **Q** — Add a textarea in setup labelled "Or type a phrase to translate" → one-shot session.
- **M** — Q + carry the typed text into the regular session if user clicks "Start session".
- **L** — Restructure: composer always visible; setup is a slide-in side panel.

**My pick: M** — Q saves clicks but isolates input. M reuses the typed text. L is a real chat-first redesign — separate ticket.

**Your choice:** Users don't want to type a single phrase. Either you want to translate a whole conversation or you don't. The onboarding is necessary. We can improve it but we cannot remove it.

**Notes:**

---

### 16. No translation-mode selector *(P1, one-way door)*

Currently a binary "GPT realtime" toggle. Future modes (Soniox-only, DeepL-only, etc.) would need a different control entirely.

- **Q** — Keep the toggle; add a `?` popover explaining the trade-off.
- **M** — Replace the toggle with `Standard ▾` dropdown listing modes.
- **L** — M + per-mode tunable parameters (latency vs. cost sliders).

**My pick: M** — One-way door: a binary toggle won't scale to 3+ modes. Dropdown from the start.

**Your choice:** For now, leave the toggle as is.

**Notes:**

---

### 17. Sidebar header scrolls away with the list *(P1)*

- **Q** — `position: sticky; top: 0` on `.sessionPanelHeader` and the New chat button.
- **M** — Q + subtle backdrop blur as content scrolls beneath.
- **L** — M + drop shadow when scrolled past zero.

**My pick: Q** — Three CSS lines. Blur and shadow are visual polish.

**Your choice:** Q.

**Notes:**

---

## P2 — Polish

### 18. 11.84px text on profile / sign-out *(P2)*

- **Q** — Bump to 13px+.
- **M** — Absorbed into the avatar menu in #9.
- **L** — Design-token type scale.

**My pick: M** — Don't tune buttons you're about to replace.

**Your choice:** L (polish this well)

**Notes:**

---

### 19. `•••` is a literal Latin ellipsis *(P2)*

- **Q** — Use vertical `⋮`.
- **M** — SVG kebab icon (3 dots, vertical).
- **L** — Shared `<Icon>` component.

**My pick: M** — Cross-platform crispness. Shared component is overkill for one icon.

**Your choice:** M or L. Use an Svg / icon. this has been designed before. Doesn't need to be vertical.

**Notes:**

---

### 20. No language-pair chip per session row *(P2)*

- **Q** — Tiny `JA→EN` chip on the right side of each row, hidden on row hover.
- **M** — Q + use flag emojis instead of codes.
- **L** — M + click filters the list to that pair.

**My pick: Q** — Quick visual aid; filter belongs with search (#12).

**Your choice:** No need to show the flags for now. This is an overkill. 

**Notes:**

---

### 21. Empty-history copy is generic *(P2)*

- **Q** — Replace with: "Your first translation will show up here."
- **M** — Q + a tappable example prompt to start a session.
- **L** — M + rotating example prompts.

**My pick: Q** — Copy fix; tappable examples push users into a flow — let them discover.

**Your choice:** M.

**Notes:**

---

### 22. Two empty placeholder pills during a live session *(P2)*

Visible in earlier screenshots — outlined pills that never resolve.

- **Q** — Remove the pills until there's content.
- **M** — Replace with a centered "Listening…" status.
- **L** — Animated audio-reactive waveform (see #24).

**My pick: M** — Q goes too quiet; users need feedback that the app is working.

**Your choice:** M. Do the "Listening.", "Listening.." and "Listening..." (as in, animate the ...)

**Notes:**

---

### 23. GPT realtime hover-only `srOnly` is invisible to sighted users *(P2)*

A11y-correct as-is. But sighted users miss the explanation.

- **Q** — Leave as-is (already correct for screen readers).
- **M** — Add a `?` icon next to the toggle with hover/click popover.
- **L** — M + "Compare modes" link inside the popover.

**My pick: M** — Discoverability. Pairs naturally with #16's dropdown.

**Your choice:** Q.

**Notes:**

---

### 24. Static waveform during recording *(P2)*

- **Q** — CSS pulse animation on the waveform bars.
- **M** — Q + a small "audio detected" dot somewhere.
- **L** — Real `<canvas>` audio-reactive bars reading the MediaStream.

**My pick: Q** — Not a one-way door. Pulse loop costs 10 CSS lines and respects `prefers-reduced-motion`.

**Your choice:** M.

**Notes:**

---

### 25. Mobile drawer doesn't auto-close on session tap *(P2)*

- **Q** — Call `setSessionsOpen(false)` in the session click handler when viewport ≤ 768px.
- **M** — Q + slide-out animation.
- **L** — M + router-based drawer state (so back-button works).

**My pick: Q** — The setState call is the fix. Animation already runs from existing transitions (once #4 lands).

**Your choice:** L.

**Notes:**

---

### 26. No user identity in the sidebar *(P2)*

- **Q** — Show `user.name` next to the brand.
- **M** — Q + initials avatar circle.
- **L** — Combined with full avatar menu in #9.

**My pick: L** — Roll this into #9; don't ship it separately and rework later.

**Your choice:** Q.

**Notes:**

---

## Suggested execution order (after decisions)

Bundles group items that touch the same code path or visual region. Each bundle = one small PR.

| Order | Bundle | Items | Effort |
|---|---|---|---|
| 1 | **Motion baseline** | #4 | 15 min |
| 2 | **Sidebar unification** | #1 #2 #3 #17 #19 #20 | 1 hr |
| 3 | **Chip + interaction polish** | #5 #6 #13 #14 #22 #24 | 1 hr |
| 4 | **Avatar menu + identity + logo link** | #9 #10 #18 #26 | 1.5 hr |
| 5 | **History UX** | #8 #12 #21 + Cmd+J/Esc from #11 | 1.5 hr |
| 6 | **Setup → talk friction** | #7 #15 (+ #23 hierarchy proposal) | 2–3 hr |
| 7 | **Modes + discoverability** | #16 #23 | 1 hr |
| 8 | **Mobile fixes** | #25 | 15 min |

## One-way doors flagged

These are decisions where shipping the **Q** path now would force a UX migration later that confuses returning users. Treat them as "pick M+ now":

- **#9** — Profile/Sign out → avatar menu. Two buttons today vs. menu later = users relearn the bottom-left.
- **#16** — Toggle vs. dropdown for modes. Adding a third mode would break the toggle pattern.

Everything else on this list is reversible CSS/component work — default to **Q**.
