# MASTER BUILD PROMPT — "Learn Together" module for Sharp Study (v2)

> **How to run:** Save the PRD as `docs/learn-together/PRD.md` and this file as `docs/learn-together/BUILD_PROMPT.md` in the Sharp Study repo. In Claude Code, enter plan mode and say:
> `Read docs/learn-together/BUILD_PROMPT.md and docs/learn-together/PRD.md, then execute the prompt.`

---

## 0. Your role and mission

You are the lead engineer augmenting the **existing Sharp Study web app** (sharpstudy.io, deployed on Vercel, MySQL database on Aiven) with a new module called **Learn Together**: parent-guided, 10–15 minute practical learning sessions for children aged 6–9 (practical math first, a small set of safe home science labs second).

The full product spec is in `docs/learn-together/PRD.md`. That PRD is the source of truth for **product behaviour**. This prompt is the source of truth for **scope, architecture and execution**. Where they conflict, this prompt wins.

**Build target:** PRD Phase 1 (MVP), **extended** with:

1. **Parent login + child login** — parents sign in with full accounts; each child gets their own sign-in on their own device, mapped to the parent's family.
2. **Connected lessons** — when a parent launches a lesson on their device, it opens on the selected child's device(s) in real time, and parent and child stay in sync step by step.
3. **Learning metrics and progress** — rich, per-child learning progress for parents, a positive learning journey for children, and an aggregated product-metrics dashboard for admins.

**Augment, don't rewrite.** Sharp Study already exists. Integrate with its stack, auth, design system, routing and conventions. Do not migrate frameworks, databases or ORMs.

---

## 1. Overrides to the PRD

These are deliberate product decisions. Apply them and update `docs/learn-together/PRD.md` with a short "Changes in v1.1" section noting each one.

| PRD reference | PRD says | This build does |
|---|---|---|
| §7 Child session mode, §18 "Child access" | No child account or independent login in the MVP | Children sign in on their own device through **parent-approved device pairing**. Children never have an email, a password or a self-created account. Parents create, control and revoke all child access. |
| §7 Cross-device behaviour | Parent and child share one device | **Connected mode** (parent device controls, child device follows) is the default when a child device is paired and online. **Single-device mode** (existing iPad split layout / child mode on the parent's device) remains the fallback. |
| §8 Explanation checker | Deterministic checks only, no AI | Child devices can submit **structured answers** (tap a choice, enter a number, mark done) to deterministic check items. Still no AI, no free text, no audio, no camera. |
| §10 Progress | Basic progress | Expanded learning metrics (§7 below), still within the PRD guardrails: descriptive, no grades, no percentiles, no streaks, no sibling comparisons. |

Everything else in the PRD stands, including no child-facing AI and no social features.

---

## 2. Phase 0 — Recon and plan (no feature code yet)

Work in plan mode. Do all of the following before writing feature code:

1. **Map the repo.** Identify: framework and version (likely Next.js — confirm App Router vs Pages Router), language/TS strictness, package manager, ORM/query layer and migration tool, auth provider, session strategy and user/role model, UI library and design tokens, state/data-fetching patterns, test frameworks, lint/format config, env var handling, CI, Vercel config, and any existing realtime, email-sending, push-notification or analytics infrastructure.
2. **Check existing health.** Install deps, run typecheck, lint and the existing test suite. Record the baseline. Do not fix unrelated breakage beyond trivial issues.
3. **Find integration points:** where a parent account maps to the existing `User`; how the existing auth issues and validates sessions (you will add a second, restricted principal type for child devices); where to mount routes; existing roles/admin area; existing payments/entitlements; existing practice or worksheet modules (a Kumon/Keel-style daily mastery practice module is planned — keep Learn Together's concept tags and progress model compatible with it).
4. **Reconcile the PRD's architecture with reality.** PRD §13 recommends Expo + PostgreSQL. **Do not adopt that.** Deliver Learn Together as a responsive web module inside the current app, installable as a PWA, covering phone browsers, iPad and desktop. Keep domain logic (content schema, session state machine, sync protocol types, recommendation engine, concept-progress rules) in framework-agnostic TypeScript so a future Expo client can reuse it.
5. **Recommend a realtime transport** (see WS4) with trade-offs for this stack: (a) a managed realtime provider (Ably, Pusher or anything already in the repo) vs (b) a no-new-service option on Vercel (Server-Sent Events and/or short polling). Check the Aiven plan's connection limit and show how idle child devices avoid holding DB connections. State your recommendation and what I need to provision, if anything.
6. **Write `docs/learn-together/PLAN.md`** containing: stack findings, integration decisions, auth design for parent and child principals, realtime design, data model mapped to the real ORM, route map, component tree, workstream order, migration plan, risks, and decisions you need from me.
7. **Present the plan and stop.** After I approve, execute all workstreams end to end without further check-ins, except for the stop conditions in §11.

---

## 3. Ground rules

- **Branch:** `feature/learn-together`. Small, reviewable commits per workstream, conventional commit messages.
- **Namespace everything.** Parent routes under `/learn`, child-device routes under `/learn/kid` (pairing entry at `/learn/join`), tables prefixed `lt_`, code in a `learn-together` feature folder following existing conventions.
- **Feature flag:** gate the entire module behind a server-checked flag (e.g. `FEATURE_LEARN_TOGETHER`), default **off** in production, on in dev/preview.
- **Migrations are additive only.** Never alter or drop existing tables or columns. Every migration must be reversible.
- **Never touch production data.** No migrations or seeds against the production `DATABASE_URL`. Use local MySQL (Docker) or a separate dev database. Do not deploy. Do not change Vercel or DNS settings.
- **Reuse before you build:** existing auth, UI components, tokens, forms, error handling, layouts, email sending.
- **No new paid third-party services** and no new production secrets without approval (the realtime choice is approved at the Phase 0 checkpoint).
- Keep `docs/learn-together/PROGRESS.md` updated after each workstream: done, decisions, deviations, open items.

---

## 4. Explicit non-goals for this build

Do not build, stub UI for, or add dependencies for:

- Child email/password accounts, child self-sign-up, or any child sign-in that bypasses parent approval
- Any child-facing AI, chatbot or open-ended AI conversation
- Voice recording, audio capture, camera use, or the Math Explanation Checker (PRD §8)
- Free-text input from children, child-to-child or child-to-parent messaging (the child's "I need help" is a fixed signal, not chat)
- Social features, public profiles, leaderboards, streaks, sibling comparisons
- Kit commerce, checkout, inventory or shipping (interest capture only)
- Native iOS/Android apps
- Phase 3 activity types (Data Detective, Claim-or-Evidence, Logic Gym, Learning Loop, Mistake Museum, speaking/creativity). The content schema must *allow* their `activityType` values later, but ship only Real-Life Math Missions and Science at Home Lab.
- Diagnostic labels, grades, percentiles or mastery claims about a child

---

## 5. Data model (map to the existing ORM)

Adapt names to repo conventions. All family data is scoped server-side on every query: parents to their family, child devices to their paired children only.

### Family, accounts and devices

| Entity | Key fields | Notes |
|---|---|---|
| `lt_family` | id, name, createdByUserId, familyPinHash, createdAt | One family per parent account by default |
| `lt_family_member` | familyId, userId, role (`owner`,`caregiver`), invitedAt, joinedAt | Parents/caregivers use existing `User` accounts. Supports two parents. |
| `lt_child_profile` | id, familyId, nickname, avatarKey, ageBand (`6-7`,`7-8`,`8-9`), language, accessibility prefs (readAloud, largeText, reducedMotion), subjectInterests, pictureCodeHash (optional) | No full name, birth date, email, phone or location |
| `lt_child_device` | id, familyId, label (parent-set, e.g. "Maya's iPad"), deviceTokenHash, pairedByUserId, pairedAt, lastSeenAt, revokedAt | Opaque device credential; no fingerprinting |
| `lt_child_device_profile` | childDeviceId, childProfileId | A device can be paired to one child or shared by several siblings |
| `lt_pairing_request` | id, familyId, codeHash, childProfileIds[], createdByUserId, expiresAt, claimedAt, claimedDeviceLabel, approvedAt, deniedAt | Single-use, 10-minute expiry, rate-limited |

### Content

| Entity | Key fields | Notes |
|---|---|---|
| `lt_activity` | id, slug, subject (`math`,`science`), activityType, tier (`free`,`paid`), currentPublishedVersionId, status | Stable identity across versions |
| `lt_activity_version` | id, activityId, version, locale, content (JSON validated by schema), reviewState, createdBy, publishedAt | Immutable once published; rollback re-points `currentPublishedVersionId` |
| `lt_content_review` | id, activityVersionId, reviewType (`subject`,`developmental`,`accessibility`,`safety`,`editorial`), reviewerUserId, decision, notes, at | Publish blocked until required reviews approved; `safety` required for all science |

### Sessions and live sync

| Entity | Key fields | Notes |
|---|---|---|
| `lt_session_group` | id, familyId, hostUserId, activityVersionId, mode (`connected`,`single_device`), state (`lobby`,`active`,`paused`,`ended`), currentStepIndex, seq (monotonic), durationMode (`full`,`short`), startedAt, endedAt | The live "room". Server state is authoritative; `seq` increments on every state change. |
| `lt_session` | id, groupId, childProfileId, status (`in_progress`,`completed`,`abandoned`), startedAt, completedAt, activeSeconds | One per child per group — the unit of progress |
| `lt_session_participant` | groupId, childProfileId, childDeviceId (nullable), joinedAt, lastAckSeq, presence (`online`,`offline`), readyAt | Tracks which device each child is on |
| `lt_step_event` | id, sessionId, stepId, enteredAt, exitedAt | Step timing for progress insights |
| `lt_child_response` | id, sessionId, childProfileId, childDeviceId, itemKey, value (structured JSON), isCorrect (nullable), submittedAt | Structured values only — never free text or media |
| `lt_help_signal` | id, sessionId, childProfileId, stepId, raisedAt, acknowledgedAt | "I need help" from the child device |
| `lt_session_check` | id, sessionId, questionKey (`near`,`transfer`), parentInterpretation (`clear`,`partial`,`not_yet`) | Parent-recorded |
| `lt_misconception_seen` | id, sessionId, childProfileId, misconceptionKey, at | Parent taps "I saw this" on a Watch-for prompt |

### Progress and feedback

| Entity | Key fields | Notes |
|---|---|---|
| `lt_observation` | id, sessionId, childProfileId, conceptTags[], outcome (`understood`,`practice_again`,`not_sure`), parentNote (optional, private), editedAt, deletedAt | Parent can edit or remove |
| `lt_concept_progress` | childProfileId, conceptTag, status (`introduced`,`practicing`,`confident`), statusSource (`computed`,`parent_override`), sessionsCount, lastPracticedAt, updatedAt | Derived by rules in WS7; recomputed on session completion |
| `lt_parent_confidence` | id, sessionId, userId, rating (1–5) | "I felt able to help with this concept" |
| `lt_saved_activity` / `lt_dismissed_activity` | familyId, childProfileId, activityId | Discovery save/dismiss |
| `lt_kit_interest` | id, userId, kitKey, activityId, at | Interest capture only |
| `lt_feedback` | id, userId, activityVersionId, kind (`usefulness_rating`,`confusion`,`safety_concern`), rating, note | Content-quality signals |
| `lt_audit_log` | id, actorType (`user`,`child_device`,`system`), actorId, action, entityType, entityId, before, after, at | Content admin, pairing/revocation, deletions, overrides |

Add roles via the existing role system if present: `lt_editor`, `lt_reviewer`, `lt_admin`.

---

## 6. Content schema and seed content

1. Define the activity content schema in TypeScript with **Zod** (or the repo's existing validator), covering every field in PRD §6 "Content record requirements": title, subject, ageBand, estimatedMinutes, learningGoal, prerequisites, difficulty, conceptTags, realWorldHook, materials (each with household substitution), noPurchaseRoute, parentPreview, **scriptSteps**, expectedResponses, misconceptions (key, signal, supportiveNextQuestion), checkQuestions, extension, shorterVersion, accessibilityAdaptations, safety (hazards, supervision, stopConditions, cleanup — required for science), optionalKit (kitKey, description, `required: false` enforced).
2. **Each script step separates audiences:**
   - `parent`: id, phase (`connect|do|explain|check|reflect`), suggestedSeconds, parentSays, whyThisWorks?, watchFor? (misconception keys)
   - `child`: childScreen (short instruction, optional image/illustration key, readAloudText), optional `interaction`: one of `done_button`, `ready_button`, `choice` (2–4 options, optional correct key), `number_entry` (optional expected value + tolerance), `ordering` (items + correct order)
3. **Check questions:** exactly two — `near` and `transfer` — each with parent interpretation guidance and an optional child-device interaction for deterministic checking.
4. Validation must **reject**: a kit marked required; a missing no-purchase route; a science activity without a safety block; no `check` or `reflect` phase; check count ≠ 2; any child-facing field containing parent-only content references.
5. **The child-device API must never return parent-only fields** (parentSays, whyThisWorks, misconceptions, interpretation guidance, expected answers). Serialize child views through a dedicated projection function and test it.
6. Store authored content as versioned JSON in `content/learn-together/`, imported via a seed script into `lt_activity_version` as **drafts**. Never hard-code content in components.
7. **Seed set:**
   - The two PRD appendix activities (Snack Budget mission; Paper Shape coin lab), fully specified including child screens and interactions.
   - Draft **10 more math missions** spanning number sense, arithmetic strategies, measurement, fractions, money, estimation, data and simple geometry, and **3 more science labs** using only paper, water, containers, household objects, plants or weather observation.
   - Science drafts exclude heat, flames, ingestion, chemicals, tools, sharp objects and biological samples. Small-part items (coins, beads) include a choking-hazard note and a larger-counter alternative.
   - Money activities use fictional prices only and never ask about real household finances.
   - **All seeded content stays `draft` with reviews pending in every environment except local dev**, where a dev-only flag may publish the two appendix activities for testing.
   - Write `docs/learn-together/CONTENT_GUIDE.md` (schema, parent vs child fields, interaction types, authoring rules, review workflow).

---

## 7. Workstreams (build in this order)

Each workstream lists acceptance criteria (AC). A workstream is done only when its AC pass and its tests are green.

### WS1 — Foundations
- Feature flag, `/learn` and `/learn/kid` route groups, layout shells, nav entry visible only when the flag is on.
- Migrations for §5 entities, ORM models, role additions.
- Shared domain package: content schema + child projection, session state machine, sync event types, recommendation engine, concept-progress rules (pure functions, no framework imports).
- **AC:** migrations go up/down cleanly on a fresh DB; flag off returns 404 for every route and hides nav.

### WS2 — Parent login, family and child profiles
- **Parent login** uses the existing Sharp Study auth (email/password and/or existing OAuth). If the existing auth lacks secure session handling, password reset or rate limiting, flag it in PLAN.md rather than replacing it.
- On first entry to `/learn`, create the parent's `lt_family`; onboarding: add children (nickname, avatar, age band), optional language/accessibility/interests, set a **4–6 digit family PIN** (hashed; used only to exit child mode on a child device), plain-language privacy explainer.
- Family settings: create, edit, delete child profiles (deletion cascades all their data after confirmation); manage family PIN; list paired devices per child with last-seen time and **Revoke**.
- **Caregiver invite:** owner invites a second parent/caregiver by email using existing email infra. If none exists, build the data model, document the gap in PLAN.md, and defer the invite UI.
- **AC:** a parent can never read or mutate another family's data (authorization tests); no birth date, full name or contact fields exist in the child model.

### WS3 — Child login via device pairing
- **Pairing flow:**
  1. Parent: Family → child (or several children for a shared device) → **Pair a device** → shows a QR code and a 6-character code (10-minute expiry, single use).
  2. Child device: opens `sharpstudy.io/learn/join` (or scans the QR), enters the code, sees "Ask your grown-up to approve."
  3. Parent device: receives an approval prompt ("A new device wants to join as Maya — approve?") with a device label field → **Approve** or **Deny**.
  4. On approval, the child device receives an opaque, long-lived device credential (stored server-side as a hash; delivered as an httpOnly, secure, SameSite cookie), and is now that child's sign-in.
- **Child login experience:** on a paired device, the child opens the app and lands in their lobby. On a shared device, the child taps their avatar; if the parent enabled a picture code for that child, they tap their 3-icon picture code. No typing, no passwords.
- **Child-device principal** is a separate, restricted auth scope. It can only: read its children's lobby and journey, read child-projected content for sessions it participates in, subscribe to its own children's sync channels, submit structured responses, send ready/help signals, and update presence. It can never call parent endpoints.
- **Locking:** child devices stay in child mode; leaving child mode or unpairing on the device requires the family PIN. Revocation from the parent's device takes effect on the next request and force-disconnects the realtime subscription.
- Rate-limit code attempts; lock a pairing request after 5 wrong codes. Auto-expire device credentials after 90 days of inactivity (configurable). Log pairing, approval, denial and revocation in `lt_audit_log`.
- **AC:** an unapproved code yields no access; a revoked device loses access immediately; a child device token cannot read another child's data or any parent-only content field (API tests); pairing works by QR and by typed code.

### WS4 — Realtime sync layer
- Build a `RealtimeTransport` interface with the implementation approved in Phase 0 and a **polling fallback that always works** (poll the group state endpoint by `seq` when the realtime connection is down).
- **Channels:** one private channel per child profile (`lt:child:{id}`) and one per session group (`lt:group:{id}`). Channel subscription is authorized server-side: parents for their family's channels, child devices for their own children only.
- **Server is authoritative.** Every state change is written to the DB first (incrementing `seq`), then broadcast. Clients that miss an event or reconnect fetch current state by `seq` — no client-to-client trust.
- **Events (typed, versioned):** `session.launched`, `session.step_changed`, `session.paused`, `session.resumed`, `session.ended`, `child.joined`, `child.ready`, `child.response_submitted`, `child.help_raised`, `child.help_acknowledged`, `presence.changed`.
- **Presence:** parent device shows each child device as online/offline; heartbeat with a light interval that doesn't hold DB connections open.
- **Latency target:** instrument launch-to-open and step-change propagation (p50/p95). Aim for step changes to appear on the child device within about a second on ordinary connections; record measured baselines in PROGRESS.md.
- **AC:** with two browser contexts, a launch and every step change propagate; killing the connection and restoring it resyncs to the correct step; out-of-order events are ignored by `seq`.

### WS5 — Home and Explore (parent)
- Home: primary CTA **"Start a 10-minute activity"**, resume an in-progress session, per-child next recommendation with its reason, and each child's device status (online / offline / not paired).
- Explore: filter by subject, duration, materials available (household / have-kit / none), activity type, low-mess, indoor/outdoor. Save, dismiss, browse freely.
- Tier gating through a single `hasEntitlement(user, feature)` helper; free tier = activities marked `tier: free`. No payment integration; paid items show a neutral "Included in full pathways" state. If Sharp Study already has billing, wire the helper to it without adding checkout.
- **AC:** filters combine correctly; only published versions appear to parents.

### WS6 — Connected activity player
- **Launch:** from an activity's preview, the parent chooses **who's learning** (one or more children). For each child, the UI shows whether their device is online. Options: **Send to [child]'s device** (connected mode) or **Use this device** (single-device mode).
- **Child device lobby:** avatar, "Waiting for your grown-up to start," and their learning journey (WS7). When a lesson is launched to that child, the lobby **automatically opens the lesson** with a gentle animation (and sound only if enabled). The child taps **I'm ready**, and the parent sees it.
- **Parent controller view:** goal, timed script (one step at a time, forward/back/pause/repeat/end), soft per-step timer that never auto-advances, collapsible "Why this works", "Watch for" with an **I saw this** tap, material alternatives, and a live panel per child showing presence, ready state, current step, submitted answers, and help signals (with Acknowledge).
- **Child follower view:** shows only the child projection of the current step — one instruction per screen, large touch targets (≥ 44×44 px), visual progress, optional read-aloud via the browser `speechSynthesis` API (on-device only), and the step's interaction (done / choice / number / ordering). Persistent **I need help** button. No settings, purchases, external links or profile management.
- **Multiple children:** each child gets their own `lt_session` under the same group, so progress is recorded per child. If siblings share one device, the child view asks "Who's answering?" (avatar tap) before recording a response; the parent records checks and reflection per child.
- **Single-device mode:** the existing child mode on the parent's device, plus a side-by-side parent script and child panel on tablets ≥ 768px. Exiting child mode requires the family PIN.
- **Check:** the two questions appear on the child device (with interactions where defined); the parent sees the child's structured answers and records `clear` / `partial` / `not_yet` with interpretation guidance shown.
- **Reflect:** the parent records `understood` / `practice_again` / `not_sure`, an optional private note, and the 1–5 confidence rating; the child device shows a warm "You explored [concept]!" close and returns to the lobby. The parent sees the recommended next step with its reason.
- **Resilience:** state is server-persisted on every change; a refresh, device switch or interruption on either side resumes at the same step. If a child device drops mid-session, the parent can continue, wait, or switch that child to single-device mode.
- **AC:** the full connected flow works parent-phone→child-iPad and parent-desktop→child-phone; single-device mode works without any paired device; the child device never receives parent-only fields (asserted at API and DOM level); the help signal reaches the parent and can be acknowledged.

### WS7 — Learning progress and metrics (parent and child)

**Concept progress rules** (pure, unit-tested, shown to parents as "how this was determined"):
- **Introduced:** at least one completed session tagged with the concept.
- **Practicing:** sessions exist but the Confident criteria are not met.
- **Confident:** at least 2 completed sessions on 2 different days; in the most recent session the reflection is `understood`, the transfer check is `clear`, and there's no `practice_again`.
- **Good time to revisit:** Confident, but not practiced in 30+ days (spaced review prompt).
- A parent can override any status; overrides are labelled as such and audited.

**Parent Progress page (per child, with date-range filter):**
- **This week:** sessions completed, learning minutes (active session time), subjects explored.
- **Weekly rhythm:** sessions per week over the last 8 weeks (chart). No streaks and no "you missed a day" messaging.
- **Concept map:** every concept with status, sessions count, last practiced, and a check history strip (near / transfer: clear · partial · not yet).
- **Child answers:** per session, the child's structured responses and whether deterministic items matched the expected answer, framed as information ("tried 7, then 8") and never as a score.
- **Misconceptions noticed:** from "I saw this" taps, with a suggested activity that addresses each.
- **Time insights:** steps where the child spent notably longer than suggested, described plainly.
- **Parent confidence trend** for the parent's own ratings.
- **Recommendations:** next activities with reasons.
- **Export** per child (CSV and JSON).
- **Guardrails:** descriptive language only. No grades, percentages of mastery, percentiles, rankings or streaks. **Never show siblings side by side or compare children**; each child's page stands alone.

**Recommendation engine (deterministic):** `understood` → extension or next activity in the pathway; `practice_again` → repeat or an easier sibling activity on the same concept; `not_sure` → shorter version or prerequisite; "Good time to revisit" concepts get spaced-review suggestions. Respects age band, dismissed activities and tier. Every recommendation returns a human-readable `reason`.

**Child learning journey (child device lobby):** a visual map or collection of concepts explored, with a gentle highlight for new ones and an "explored again" mark. No numbers, scores, counts-to-beat, streaks, or comparisons.

**AC:** progress rules and the recommendation engine have unit tests for every branch and edge case (no history, all dismissed, override, revisit window); progress recomputes on session completion; a parent can edit or delete an observation and the derived status updates.

### WS8 — Optional kits (interest only)
- Activities with an `optionalKit` show a parent-only "Tell me about this kit" control, recording `lt_kit_interest`. Copy states the kit is optional and the activity works without it.
- **AC:** kit UI never appears on child devices or in child mode; every kit-linked activity remains fully completable without it.

### WS9 — Content admin
- Role-gated admin: list, create, edit draft versions (JSON editor with live schema validation, plus side-by-side **parent preview** and **child-device preview**), request reviews, record decisions per review type, publish, retire, version history, roll back.
- Publish is blocked until all required reviews are approved; science requires `safety`. A reviewer cannot approve their own draft.
- Every admin action is written to `lt_audit_log`. Parent confusion reports and safety concerns are visible per activity.
- **AC:** an editor cannot publish without approvals; rollback restores the previous version immediately, including for lessons launched afterwards.

### WS10 — Privacy, safety and trust
- Parent data controls: view, export (JSON) and delete child profiles and all Learn Together data; hook into the existing account-deletion flow if one exists.
- Paired-device list with revoke; family PIN reset requires parent re-authentication.
- No ads, no added third-party trackers, no child data in URLs or query strings, no child nickname or responses in analytics or logs.
- Per-activity "Report a safety concern" and "Something was confusing" for parents.
- Write `docs/learn-together/PRIVACY_NOTES.md`: data inventory (field, purpose, retention), child-device credential handling, deletion behaviour, and items for legal review before public launch (child privacy law in launch markets, parental consent for child device access, consumer protection, accessibility, physical product rules for future kits).
- **AC:** deleting a child removes all associated rows and unpairs devices (test); export contains only that family's data.

### WS11 — Analytics and product-metrics dashboard
- First-party events through the app's existing analytics layer if present, else a minimal `lt_analytics_event` table.
- **Events:** `lt_onboarding_completed`, `lt_child_profile_created`, `lt_pairing_started`, `lt_pairing_approved`, `lt_pairing_denied`, `lt_device_revoked`, `lt_activity_previewed`, `lt_session_launched` (mode, child count), `lt_launch_received` (latency ms), `lt_step_sync` (latency ms, sampled), `lt_child_ready`, `lt_child_help_raised`, `lt_child_response_submitted` (isCorrect only), `lt_misconception_observed`, `lt_session_resumed`, `lt_session_completed` (reached reflection), `lt_session_abandoned` (last step), `lt_check_recorded`, `lt_reflection_recorded`, `lt_parent_confidence_rated`, `lt_concept_status_changed`, `lt_concept_status_overridden`, `lt_usefulness_rated`, `lt_confusion_reported`, `lt_safety_concern_reported`, `lt_kit_interest_clicked`, `lt_recommendation_followed`.
- **Properties:** activity id/version, subject, mode, duration mode, device class, outcome enums, latency. **Never** nicknames, free-text notes or raw response values.
- **Admin metrics dashboard** (role-gated, aggregated, cells with fewer than 5 families suppressed):
  - North star: weekly completed teach-together sessions per active family
  - Activation: new families completing a first session within 7 days
  - Session completion rate; repeat use (2nd session within 14 days, 3rd within 30)
  - Connected-mode adoption (% of sessions on a paired child device); pairing success rate
  - Sync health: launch and step-propagation latency p50/p95, reconnects, failed launches
  - Per-activity funnel with drop-off step, usefulness rating, confusion and safety reports
  - Parent confidence average; concept-status movement (introduced → practicing → confident)
  - Kit interest by activity; device mix
- Document every event and the formula behind each dashboard metric in `docs/learn-together/ANALYTICS.md`.

---

## 8. Non-functional requirements

- **Accessibility:** WCAG 2.2 AA target — keyboard operability, visible focus, screen-reader labels, contrast, text scaling to 200%, reduced motion, no audio-only instructions. Automated axe checks on Home, Explore, Preview, Parent controller, Child lobby, Child follower, Progress, Pairing and Admin.
- **Responsive:** phone (≤ 430px), tablet (768–1024px), desktop; child views tested at phone and tablet sizes in both orientations.
- **PWA:** installable on iOS/Android home screens so a child device can launch straight into the lobby. Web push for "lesson launched" while the app is closed is **deferred**; note it in PROGRESS.md.
- **Performance:** keep the module light; cache published content; lazy-load admin. Instrument page load, launch latency and step-change latency, and record baselines rather than inventing SLOs.
- **Security:** server-side authorization on every endpoint, server action and channel subscription; separate parent and child-device principals; input validation at the boundary; least-privilege roles; no secrets in client bundles; CSRF protection on child-device cookie flows.
- **Localization-ready:** all UI strings through the app's i18n mechanism if present (else a simple message catalog); content carries `locale`.

---

## 9. Testing and quality gates

Use the repo's existing test tools; add Playwright for e2e only if no e2e tool exists.

- **Unit:** content schema (valid and every rejection rule), child projection (no parent-only fields leak), session state machine, sync `seq` handling, recommendation engine, concept-progress rules, entitlement helper.
- **Integration:** family scoping (family A cannot reach family B through any endpoint or channel); child-device scope (cannot call parent endpoints, cannot read sibling-unpaired or other-family data); pairing lifecycle (expiry, single use, rate limit, approval, denial, revocation); publish gating; audit logging; cascading deletes.
- **E2E with two browser contexts (parent + child):** pair a device by code → approve → child lobby → parent launches Snack Budget → lesson auto-opens on child → step sync → child answers a check → help signal → parent reflects → child sees close and journey update → parent sees progress and recommendation. Also: reconnect recovery, revoked device kicked out, single-device fallback, multi-child launch, flag off returns 404.
- **Accessibility:** axe on the §8 pages, zero serious or critical violations.
- **Gate before marking any workstream done:** typecheck, lint, all tests green, migrations reversible, no regressions in the baseline suite.

Write `docs/learn-together/QA_CHECKLIST.md` for my manual pass with a real phone (parent) and an iPad (child), including a weak-network test.

---

## 10. Execution order summary

WS1 Foundations → WS2 Parent login & family → WS3 Child device login → WS4 Realtime sync → WS5 Home & Explore → WS6 Connected player → WS7 Progress & metrics → WS8 Kits → WS9 Content admin → WS10 Privacy → WS11 Analytics & dashboard.

---

## 11. Stop conditions — pause and ask me

Stop and ask only if:

1. A required change would alter or drop an existing table or column, or change the existing auth or user model (adding a separate child-device principal alongside it is expected and approved).
2. The existing auth system cannot support a second restricted principal without structural change.
3. You need a new paid service, external API or production secret beyond the realtime option approved in Phase 0.
4. Any step would touch the production database, Vercel project settings, domain/DNS, or trigger a production deploy.
5. The baseline test suite is broken in a way that blocks verifying your work.

For anything else, make the most reasonable call, log it in PROGRESS.md under "Decisions", and keep going.

---

## 12. Final deliverable

When all workstreams pass their gates, end with a report containing:

- What shipped per workstream, and anything deferred
- Files and folders added; existing files modified (with why)
- Migrations added and how to run and roll them back
- How to enable the flag in a Vercel preview and test connected mode with two devices
- Realtime setup steps (keys, env vars) if a provider was approved
- Measured sync latency baselines
- Decisions made without me, and open questions
- Content status: which activities exist, all pending human review
- PRD §16 "Public launch gate" checklist, each item marked done / not done / needs human
