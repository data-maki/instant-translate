# Research Notes: Vibe-Preserving Participation, Not Translation

Date: 2026-05-14

## Prompt / motivating example

Source: Rakuten Today / Hiroshi Mikitani, “Japan's new business language: English”
https://rakuten.today/mickeysvoice/englishnization-japans-new-business-language.html

Rakuten’s “Englishnization” is a useful stress case: mostly Japanese speakers were forced to conduct official business in English. This intentionally removed Japanese hierarchy markers / keigo friction and made the company more globally legible, but it also created a gap between comprehension, self-expression, status, and identity.

The interesting user need is not “translate my words.” It is:

> I understand the conversation, but I cannot express myself with the same nuance, timing, or social safety in the required language.

A socially graceful escape hatch might be:

> すみません、これは日本語でしかうまく表現できないので、日本語に切り替えてもよろしいですか。

Or in English-speaking company contexts:

> Sorry, I can only express this precisely in Japanese — can I switch briefly?

That sentence itself is a product primitive: “permissioned language switch.”

## Thesis

Translators kill the vibe because they optimize semantic equivalence while ignoring social participation.

The product should be a conversational agency layer:

- preserve timing
- preserve speaker identity
- preserve social stance
- help the user enter / hold / exit the conversational floor
- know when code-switching is better than translating
- make explicit when nuance will be lost

For Mother-in-Law Decoder, this suggests moving beyond “real-time transcription + translation” toward “real-time participation support.”

## Important distinction

Listening ability and speaking ability are asymmetric.

Many people can:

- follow native speech well enough
- understand topic and emotional valence
- know what they want to say

But cannot quickly produce:

- idiomatic phrasing
- culturally safe politeness
- humor / warmth
- disagreement without face-loss
- precise technical or emotional nuance

The product should not assume the user is linguistically helpless. They may be socially present but output-constrained.

## Product primitives

### 1. Permissioned code-switch

When the user’s intended thought is too subtle for their target-language ability, offer a polished phrase to switch languages without derailing the room.

Japanese → English meeting:

- “Sorry, I can only express this precisely in Japanese — can I switch briefly?”
- “I’ll say this part in Japanese because the nuance matters.”
- “Let me use Japanese for one sentence, then I can summarize in English.”

English → Japanese meeting:

- すみません、この部分だけ英語で説明してもよろしいですか。
- ニュアンスを正確に伝えたいので、一度英語で言わせてください。
- まず英語で説明して、その後で要点だけ日本語でまとめます。

Key: preserve dignity. Do not frame it as failure.

### 2. Interjection support

Fast floor-taking phrases, not full translations.

Japanese examples:

- すみません、一点だけ補足してもよろしいでしょうか。
- 今の点について、少し確認してもいいですか。
- ちょっとだけ戻ってもいいですか。
- 認識が違っていたらすみませんが…
- うまく言えないのですが、要するに…

English examples for Japanese speakers forced into English:

- Sorry, can I add one point?
- Can I clarify one thing?
- I may be misunderstanding, but…
- Let me phrase this carefully.
- I understand the point, but I need a moment to explain my view.

### 3. Aizuchi / backchannel layer

In many conversations, “participation” is mostly small timely signals.

Japanese:

- なるほど
- たしかに
- そうなんですね
- それは大変でしたね
- 面白いですね
- たしかに、それはありますね

English for Japanese speakers:

- Right.
- That makes sense.
- I see what you mean.
- That’s a good point.
- Ah, I hadn’t thought of it that way.

This layer should be short, low-latency, and socially calibrated.

### 4. Vibe-preserving rewrite

Rewrite the same intent in multiple target-vibes:

- precise
- warm
- deferential
- direct
- soft disagreement
- executive concise
- family casual
- client-safe

Do not over-formalize. Over-politeness can be as alienating as rudeness.

### 5. “I understood, but need time” phrases

These are high-value panic buttons.

Japanese:

- 理解はできているのですが、日本語でうまく表現するのに少し時間がかかります。
- 少し整理してからお伝えしてもよろしいでしょうか。
- 後ほど要点をまとめてお送りします。

English:

- I understand, but I need a moment to phrase it clearly.
- Let me organize my thoughts for a second.
- I can follow the discussion, but explaining my view in English takes me a little longer.

## Research questions

1. When do bilingual speakers prefer assisted target-language output vs explicit code-switching?
2. What phrases make code-switching feel competent rather than apologetic?
3. How does forced language choice reshape hierarchy, confidence, and perceived intelligence?
4. What is the minimum latency for useful interjection support? Probably sub-2s; for aizuchi, sub-500ms.
5. Does register support matter more in workplace contexts, family contexts, or service/customer contexts?
6. Can the system infer “vibe context” from transcript alone, or does it need explicit relationship metadata?
7. What should never be translated because the speaker’s identity/vibe would be damaged?

## Data to collect

For each conversational moment:

- transcript window before the desired intervention
- speaker role / listener role
- language being spoken
- user’s native language
- intended speech act: agree, disagree, clarify, add, defer, joke, apologize, switch language
- relationship metadata: family/client/boss/peer/vendor/senpai/kouhai/etc.
- target vibe
- successful human phrase
- failed / awkward machine phrase
- native-speaker rating
- whether code-switching would be better than translation

## Possible UX

### Live mode

Transcript visible but secondary. Main UI shows “conversation moves”:

- Add one point
- Clarify
- Soft disagree
- Buy time
- Switch language
- Summarize what I heard
- Ask them to repeat
- Make it warmer

Each button yields 1–3 short phrases. The user says it themselves when possible.

### Relationship presets

- spouse’s parent / family dinner
- client
- boss
- peer coworker
- senior coworker
- professor
- stranger/service worker

Each preset changes register, warmth, and risk tolerance.

### Code-switch button

One tap produces context-appropriate permission phrase and optional summary:

1. request permission to switch
2. user speaks in native language
3. app optionally summarizes in target language

This avoids the “robot translator hijacks the vibe” failure mode.

## MVP direction

Build a research prototype inside Mother-in-Law Decoder:

1. Capture rolling transcript context.
2. Add manual “speech act” buttons.
3. Generate short native phrases for interjection, code-switching, and panic recovery.
4. Keep phrases short enough to be spoken by the user.
5. Log which phrase the user selected / edited / ignored.

Do not start with full duplex speech translation. That is the trap.

Start with:

> live transcript → relationship context → one-tap conversation move → short phrase

## New idea: improve the outcome of meetings in real time

This expands the product beyond language assistance.

Meeting goal:

> Help people produce better meeting outcomes while the meeting is happening.

Not just “record and summarize later.” The useful wedge is in-meeting support:

- retrieve relevant context at the moment it is mentioned
- surface prior decisions / open loops
- help the user ask sharper questions
- detect ambiguity, missing owners, or unspoken assumptions
- produce short, socially appropriate interjections
- help non-native speakers participate without losing timing or dignity

Core framing:

> live meeting → rolling context → just-in-time retrieval + suggested moves → better decisions / clearer commitments

### Meeting copilot primitives

1. Query the room/context privately

- “What are they referring to?”
- “Did we already decide this?”
- “What was the last action item?”
- “Who owns this?”
- “What doc/email/slack thread is relevant?”

2. Suggest useful interventions

- “Ask whether this is for Q3 launch or long-term roadmap.”
- “Clarify owner and deadline.”
- “They are assuming legal approval; verify that.”
- “This sounds like a pricing decision, but no decision-maker has been named.”

3. Convert context into a speakable move

Example:

> “One thing to clarify: are we deciding this for the Q3 launch, or are we talking about the longer-term roadmap?”

Japanese / relationship-aware variant:

> すみません、一点だけ確認させてください。こちらはQ3のローンチに向けた判断でしょうか、それとも中長期の方針のお話でしょうか。

4. Preserve meeting flow

The system should avoid long paragraphs. It should return short, timely, source-backed prompts that help the user act while the conversation is still alive.

### Why this belongs with Mother-in-Law Decoder

The original project helps the user understand live multilingual conversation. This idea extends the same throughline:

- understand what is being said
- understand what matters
- retrieve what the user needs to know
- help the user participate at the right moment
- improve the actual outcome of the conversation

This can work for family conversations, work meetings, sales calls, doctor visits, immigration/legal appointments, and any setting where context + timing matter.

### MVP shape

- live transcript buffer
- local notes/docs/calendar index
- hotkey command palette
- query: “what is X / did we decide Y / what should I ask?”
- answer with citations + one optional phrase to say out loud
- log selected suggestions and whether they changed the meeting outcome

Do not build another post-meeting summarizer. Build a meeting outcome improver.

## Product name candidates / framing

- Social Fluency Layer
- Vibe-Preserving Interpreter
- Conversational Exoskeleton
- Participation Copilot
- Code-Switch Copilot
- Floor-Taking Assistant
- Meeting Outcome Copilot
- In-Meeting Context Engine
- Just-in-Time Meeting Memory

## New idea: meeting assessment / outcome audit as a service

Source: Corey Ganim tweet/thread
https://x.com/coreyganim/status/2054516734170706279?s=20

Scraped summary: Corey describes selling $999 AI assessments to business owners, built from a 45-minute workflow interview, then delivering a report with 3–7 tool recommendations, time-savings estimates, quick wins, and implementation upsells. The important pattern is not the exact AI-consulting offer; it is the monetizable shape:

> sell clarity first, then implementation.

Applied to this project:

Instead of only building a live meeting copilot, there may be a services/product wedge around “meeting outcome assessments.”

Offer:

- record / ingest a few real meetings
- analyze where meetings lose value
- identify recurring failure modes
- recommend specific changes, automations, retrieval hooks, and live-copilot features
- estimate time saved / decision quality improved
- upsell implementation of the actual meeting copilot stack

### Assessment questions

Borrowing the Corey-style interview pattern, ask teams:

- Walk me through your recurring meetings.
- Which meetings feel necessary but wasteful?
- Where do people leave without clear decisions?
- Where do people need context they do not have in the moment?
- What gets repeated across meetings?
- What facts/docs/threads do people always have to hunt for?
- Who is usually silent but should contribute?
- Where do language, hierarchy, or confidence issues affect participation?
- What decisions would have been better if the right context had appeared live?

### Report structure

- Executive summary: top 3 meeting outcome leaks
- Meeting map: recurring meetings, participants, goals, failure modes
- Impact/effort matrix
- 3–7 recommendations:
  - live context retrieval
  - suggested clarification questions
  - better action-item capture
  - decision log / prior-decision recall
  - language/interjection support
  - pre-meeting briefs
  - post-meeting follow-through automation
- Quick wins plan
- Implementation roadmap
- Estimated time/quality impact

### Why this matters

This turns the vague product promise “AI for meetings” into a concrete business buyer promise:

> We help your meetings produce better decisions, clearer owners, and fewer repeated conversations.

It also creates a learning loop: every assessment produces training data for the eventual product — real meeting failure modes, real retrieval needs, real intervention moments.

### MVP service wedge

Start manually:

1. interview team lead / founder / operator
2. ingest 2–5 meeting transcripts + related docs
3. produce a meeting outcome audit
4. recommend 3 live-copilot interventions
5. implement one lightweight prototype: hotkey query, prior-decision recall, or action-item clarification

This is probably easier to sell than a generic meeting bot because the deliverable is immediate clarity.

## Notes from Rakuten case

Rakuten’s English-only policy shows both promise and cost:

- Promise: less Japanese hierarchy encoded in language; global employees can access the same communication; less translator bottleneck.
- Cost: non-native English speakers may lose precision, status, humor, and confidence.
- The “English has fewer power markers” point is especially relevant: language choice is not neutral; it changes org structure.
- For a product, this means “help me speak English” is also “help me remain myself while English changes the social physics.”

## Core design warning

Never make the user wait while the app produces a perfect paragraph. The turn will die.

Prefer:

- pre-rendered microphrases
- short social moves
- graceful code-switches
- user-spoken output
- optional after-the-fact summaries

The goal is conversational agency before fluency.
