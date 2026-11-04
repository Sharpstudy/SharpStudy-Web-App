# Mastery Ladder — Implementation Status

Last updated: 2026-10-14 · Branch: `feature/sharpstudy-updates` (uncommitted; Git left to the owner)

## Important context

The prompt refers to a "complete Mastery Ladder specification". **No such document
exists in this repository or its git history** (`docs/redesign/02-mastery-ladder-plan.md`
already noted it was missing). Everything below is built from the requirements and
acceptance criteria in the implementation brief. Rules the brief did not pin down are
isolated as named, documented assumptions (see *Assumptions*) so they can be changed
in one place once the spec is supplied.

## 2026-10-14 update — what changed

| Area | Change |
|---|---|
| Learner permissions | Creating learner profiles now needs the `learners.create` permission (built in for instructors and admins; granted to families through the seeded **Family** role). Plain student accounts and learner (PIN) sessions get **403**; anonymous **401**. Accounts that already owned learners are given the Family role by the seeder so nothing they had is lost. UI hides *Add learner* when `canCreate` is false. |
| Mastery rules (spec) | 10 worksheets/set, 8 questions, 180 s target for every worksheet, mastery accuracy 0.9, set-exit accuracy 1.0, speed factor 1.0, brisk factor 0.7 (3★). **Practice-speed (accurate but slower than target) now keeps the learner on the same worksheet** (new numbers) — `RULES.requireSpeedToAdvance = true`. |
| Curriculum | Math J–O were placeholders; all 12 missing sets now have generators (`lib/mastery/generators/math_advanced.js`). Every set of every required level (Math 21 levels, English 9, Physics 7, Chemistry 7) is ready and covered by the generation sweep test. |
| Dashboards | Family/instructor dashboard gained a **Needs more practice** list (`lib/mastery/insights.js`). |
| Live questions in Jitsi | New: instructors publish single-answer questions inside the existing Jitsi class; students answer without leaving it. See *Live questions* below. |
| Security | Fixed four confirmed problems (below). |
| Tests | Moved from `public/tests` (which would have been served publicly) to `tests/`; `yarn test` now also runs the live-question tests. |

### Security fixes made (all confirmed by reading the code, then by tests)

1. `PUT /api/admin/make-admin` (and `instructor/requests`, `instructor/instructors`, `admin/courses*`, `categories*`, `coupons*`, `testimonials/create`) only checked that an `Authorization` header **existed** — any string passed, so anyone could make themselves admin or approve instructors. They now verify the signed token and re-read the role from the database (`lib/auth/requireRole.js`): 401 anonymous, 403 non-admin.
2. `GET /api/students` had **no authentication** and returned every student row **including password hashes**. It is now admin-only and the hash is never selected.
3. `User` now has a default scope excluding `password` and `reset_password_token`, so no endpoint can leak them by returning a user row (this also covers `GET /api/users/update`, whose result is placed in page props). Sign-in and re-authentication use `User.unscoped()`.
4. Learner creation by plain students (above).

Still open (not changed; reported): ~17 other legacy routes (course/quiz/question/wishlist/learnings/upload) use the same header-presence check and need a per-route review of ownership; Stripe test key and SMTP settings in `next.config.js` / `email-templates/config.js` should move to env vars; `GET /api/courses/course` is public and the Jitsi room name is the course slug, so anyone who knows the slug can join the Jitsi room itself (the new live-question API does enforce enrolment, the video room does not).

## Live questions inside the existing Jitsi class

No second classroom, video provider, scheduler or attendance system was added. A "class" is a course; the Jitsi room is still the course slug and `LiveClassComponent` / `react-jutsu` are unchanged apart from rendering `LiveQuestionsPanel` **next to** the Jitsi frame (a sibling, so asking/answering never re-renders or reloads the video).

**Instructor** (course owner, or an admin): open *Live questions* beside the video → *Ask a question* → type the question and 2–6 answers, tick the correct one, optionally add an explanation, a countdown (5–3600 s) and "students may change their answer" → *Publish now* (or *Save as draft*, then *Publish*). Or copy a single-answer question from your existing quizzes. While it runs you see answered/total, the answer distribution and who has/hasn't answered, updating every ~2.5 s. *Close submissions*, *Reveal answer* (shows correct answer + explanation to students; also closes), *Publish results to students* (distribution only). *Next question* closes the previous one and publishes the new one — the Jitsi call keeps running. *Review saved results* lists every question with per-student results.

**Student** (enrolled in the course): the question appears automatically in the panel (a "New question" badge shows if the panel is collapsed, e.g. on a phone); pick an answer and submit; a confirmation shows; a countdown shows when set; after the instructor reveals, the correct answer, explanation and the student's own result appear. Students never receive the correct answer, other students' answers or names before/without release.

**How it is synchronised:** short polling (`GET /api/live-questions/<slug>/state/` every 2.5 s, 8 s when the tab is hidden). No new real-time server. Chosen because the app deploys to serverless (Vercel) where WebSockets are unavailable. The same endpoint is the reconnection path: after any disconnect the next poll returns the full current state, and re-sending an answer is an idempotent no-op. Latency is therefore up to ~2.5 s, and each connected user costs ~24 requests/min (rate-limited to 90/min/user per server instance).

**Server rules:** identity comes only from the signed login token (a `userId` in the body is ignored); instructor = `courses.userId` or role admin; student = row in `enrolments` for that course; anyone else 403; a question id from another class is 404. The server clock sets the deadline (`deadline_at`) and rejects late/closed submissions (409); `is_correct` is computed on the server; a unique index `(live_question_id, user_id)` prevents duplicate rows; changing an answer only when `allow_change`. Live-question scores are stored in their own tables and **never touch Mastery Ladder progress or the existing course quizzes**.

**API:** `GET state`, `GET|POST questions`, `POST|DELETE questions/<id>` (`action`: `publish|close|reveal|publish_results`), `POST questions/<id>/answer`, `GET my-results`, `GET importable` — all under `/api/live-questions/<slug>/`.

**Migration:** `20261014000000-create-live-questions.js` — creates `live_questions` and `live_question_responses` (additive; `yarn migrate`).

## Verification summary

| Check | Result |
|---|---|
| `yarn test` (Node test runner, 7 files) | **59 / 59 pass** |
| `yarn test:e2e` against `next dev` + local MySQL | **46 / 46 checks pass** |
| `next build` | **Succeeds** |
| `next lint` on all new code | **No warnings or errors** |
| Migration on local dev DB | Applied; seeder re-run is idempotent |
| Client bundles scanned for secrets/server code | Clean (only admin help text naming `ANTHROPIC_API_KEY`) |
| Real Claude API call | **Not verified** — no `ANTHROPIC_API_KEY` available; fallback path verified |
| Interactive browser walkthrough | **Not performed** — pages verified to server-render (HTTP 200) and APIs end-to-end; click-through UI testing is in *Manual testing* below |

## Phase status

| Phase | Status |
|---|---|
| 1 Curriculum & worksheet engine | Implemented & verified. All required levels (Math 7A–O, English E7A–EC, PH1–PH7, CH1–CH7) have working generators; no placeholder sets remain. The `ready:false` mechanism still exists for future additions. |
| 2 Student study experience | Implemented & verified (API e2e + unit). UI compiled and server-renders; not click-tested in a browser. |
| 3 Parent / instructor dashboard | Implemented & verified (API). Email sharing uses the existing SMTP transport — sending not verified (no test inbox); mailto fallback provided. |
| 4 Printable worksheets | Implemented & verified (API + unit). Print CSS not checked on paper. |
| 5 Sage AI tutor | Implemented & verified with test doubles and fallback; live Claude call unverified (no key). |
| 6 Admin, authorisation, audit | Implemented & verified (unit + e2e). |
| 7 Database & offline sync | Implemented & verified (migration applied locally; idempotency unit + e2e). |
| 8 Tests & docs | Done (this file, README section). |

## Requirement checklist

### Phase 1 — curriculum & engine
| Requirement | Implementation | Tests |
|---|---|---|
| Math 7A–O, English E7A–EC, PH1–PH7, CH1–CH7 | `lib/mastery/curriculum.js` (21 + 9 + 7 + 7 levels, every set ready) | `engine.test.mjs` "curriculum covers required levels" asserts every set of every required level has a generator; "every ready set generates valid, self-consistent sheets" generates 10 worksheets × 6 variants per set and self-grades every answer |
| Not-ready content clearly identified, never served | `ready: false` sets; excluded from ladder, start, print, placement | "every ready set…", "unlock rules", print/service tests |
| FNV-1a + mulberry32, int/pick/shuffle | `lib/mastery/rng.js` | FNV reference vectors, determinism tests |
| `generateSheet(levelId, setId, worksheetNo, variant)` | `lib/mastery/sheet.js` | "identical seed produces identical worksheets" |
| Problem / Answer / RichText / Scene structures | `lib/mastery/problem.js` (documented shapes) | sweep test validates every generated problem |
| Integer, decimal, fraction, text, choice, multi, expression grading | `lib/mastery/answers.js`, `expression.js` (no eval) | answer-type tests incl. unsafe-input cases |
| Diagrams with accessible rendering | `components/Mastery/Scene.js` (role=img + labels); counting labels list items without announcing totals | "diagram labels never announce the answer" |
| Pure grading & progression | `rules.js`, `grading.js` | all acceptance-criteria tests |

### Phase 2 — study experience
| Requirement | Implementation | Tests |
|---|---|---|
| Profile picker, learner creation, 4-digit PIN | `pages/study/index.js`, `components/Mastery/{PinPad,LearnerForm}.js`, `/api/mastery/learners`, `/unlock` | service + e2e PIN tests |
| Hashed PIN, lockout, authorised reset | `service.js` (bcrypt, 5 tries → 10 min lock), `/pin` | "PINs are hashed…", "only authorised adults can reset" |
| Dashboard: subjects, level, goal, streak, stars, habit grid | `pages/study/index.js`, `studyHome()` | e2e "study home" |
| Sequential unlocking enforced server-side | `isUnlocked()`, `startWorksheet()`, `printSheets()` | "locked worksheets cannot be opened by URL/API", print tests, e2e |
| One-question player, keyboard + on-screen keypad, timer & target | `pages/study/worksheet.js`, `AnswerInput.js` | compiled; manual |
| Immediate validation + required correction | player uses shared `checkAnswer`; server rejects sheets with uncorrected answers | grading test "requires correction" |
| Accurate first-attempt scoring | `gradeResponses()` | grading + e2e "7/8 first try" |
| Leave/abandon never records completion | player "Save & leave" / "Abandon" only touch local storage | manual |
| Results: accuracy, duration, stars, next action | player `Results` + `nextActionLabel()` | e2e asserts server result fields |
| Persistent progress across refresh/sessions | in-progress in localStorage (`offline.js`); progress in DB | offline + service tests |
| Client cannot advance placement | signed start token, server re-grade, duration bounded | "submissions are idempotent and cannot be forged", "implausible durations" |

### Phase 3 — parent / instructor dashboard
| Requirement | Implementation | Tests |
|---|---|---|
| Learner management & switching | `pages/family/index.js` tabs, `LearnerForm` | e2e create/remove |
| Enrolment toggles | `/enrolment`, `setEnrolment()` | service tests |
| Level/set/worksheet/progress | `learnerDashboard()` | "dashboard metrics…" |
| Completed, accuracy, time, streaks, attendance, last practised | dashboard `stats`, `streak` | unit + e2e |
| 21-day habit grid | `HabitGrid.js`, `habitGrid()` | habits test |
| Configurable daily goal | PATCH `/learners/:id` | manual |
| Day/week/month charts (real data) | `ActivityChart.js`, `bucketActivity()` | habits + dashboard tests |
| Recent attempts + hints used | dashboard `recent` table | "hint use is persisted" |
| Adult learner mode (adult-controlled) | `/adult-mode` (account actors only) | placement test, e2e |
| Placement override with explicit confirmation | `PlacementDialog.js`, `setPlacement(confirm)` | "placement: only authorised adults…" |
| PIN reset; removal & reset with typed confirmation | `AccessCard`, `DangerCard`, `resetPin/resetProgress/removeLearner` | "removal and progress reset need typed confirmation" |
| Daily reminders + calendar download | reminder time on learner; `/calendar` → `.ics` (daily RRULE in learner TZ) | "calendar reminder is a valid daily iCalendar event", e2e |
| Progress sharing by email | `/share` (existing nodemailer transport) + mailto fallback | not sent in tests (no inbox) |
| Instructor access | guardians (`relation: instructor` — view + place, not admin) | placement test |

### Phase 4 — printing
| Requirement | Implementation | Tests |
|---|---|---|
| Subject/level/set/unlocked worksheet selection | `pages/print/index.js` (only unlocked options listed) | — |
| Equivalent variants | variants `PRINT_VARIANT_BASE + k` (separate from study variants) | "print uses the same deterministic generator" |
| Answer keys / prefilled copies (protected) | `printSheets()` — adults or adult-mode learners only | "answer keys … adult-only" |
| Learner name; A4/Letter; name/date/duration/score fields; answer lines; target time + seed footer | `PrintedSheet`, `@page` size, `_mastery.scss` print rules | manual |
| Locked worksheets cannot be printed | `printSheets()` | "locked worksheets cannot be printed", e2e |

### Phase 5 — Sage tutor
| Requirement | Implementation | Tests |
|---|---|---|
| Replay lesson / explain with different numbers / similar worked example | `tutor.js` (`similarExample` guarantees a different question and answer) | tutor tests |
| Optional Socratic chat, admin-controlled | `tutor.chatEnabled` setting (off by default) | "chat is off by default; admins can enable" |
| ~3 sentences, age-appropriate | system prompt + `limitSentences()` | "limitSentences…" |
| Context from level/set/question/attempt | rebuilt from signed start token | "browser-supplied answers are ignored" |
| Hint tracking persisted | `ml_hint_events` → `ml_attempts.hints_used` | "hint use is persisted" |
| Friendly fallback when AI unavailable | deterministic lesson/example text | "AI outages fall back…" |
| Key server-only | `lib/mastery-server/ai.js`, official `@anthropic-ai/sdk` | bundle scan |
| No answer leakage | `containsAnswer()` on every reply (AI and built-in) | exhaustive leak sweep over all ready sets × modes with a deliberately leaky AI |
| Rate limits & validation | per-IP + per-learner hourly limit; mode/index validation | "tutor requests are authorised, validated…" |

### Phase 6 — admin & authorisation
| Requirement | Implementation | Tests |
|---|---|---|
| Users & role management | `/admin/users`, `admin.listUsers/setUserRole` (cannot demote self) | admin tests |
| Permission-based authorisation; roles & access rights | `policy.js` (built-in grants + custom `ml_roles`), `/admin/roles` matrix | "custom roles grant permissions that the server enforces" |
| Access-denied screens | `components/Mastery/AccessDenied.js` in `/admin/mastery` | manual |
| Learner management needs global permission | `learners.manage_all` | admin tests |
| Audit: logins, placement, PIN changes, resets | `ml_audit_logs`; `auth.login` / `auth.login_failed` added to existing sign-in (non-blocking) | "audit log records…", e2e |
| Global reset (permission + typed phrase + password) | `/admin/global-reset` | "global reset needs permission, phrase and password", e2e |
| AI tutor configuration | `/admin/settings` | tutor tests |
| Presence | `/presence` heartbeat (from `MasteryShell`), `/admin/presence` | admin + e2e |
| Feedback + optional screenshot | `FeedbackButton.js` (html-to-image), `/feedback`, `/admin/feedback` | feedback tests |
| Server-side enforcement | every handler → service permission checks | "unauthorised users cannot use restricted admin functionality", e2e |

### Phase 7 — data & offline
| Requirement | Implementation | Tests |
|---|---|---|
| Tables, indexes, constraints, UTC + family-local days | `20261012000000-create-mastery-ladder.js`, `database/models/mastery.js` | migration applied locally; e2e |
| In-progress persisted locally; offline queue; client attempt id | `lib/mastery/offline.js`, `lib/mastery-client/sync.js` | offline tests |
| Idempotent sync, retries, conflicts | unique `(learner_id, client_attempt_id)`; claim-then-apply; progress `version` CAS; permanent vs transient errors | "offline attempts synchronise without duplicates", "two devices…" |
| Server validation of client scores/progression | `submitAttempt()` | forging tests |

## Assumptions (change in one place)

| Assumption | Where |
|---|---|
| 8 questions per worksheet, 10 worksheets per set, 180 s target on every worksheet (per-set targets in `curriculum.js` are now ignored) | `RULES` in `lib/mastery/rules.js` — values come from the 2026-10-14 brief |
| 3★ ≤ 0.7 × target (brisk factor); 2★ ≤ 1.0 × target (speed factor); 1★ slower but accurate | `RULES.briskFactor`, `RULES.speedFactor` |
| Mastery needs ≥ 0.9 first-try accuracy (with 8 questions that is 8/8); set exit (last worksheet) needs 1.0 | `RULES.masteryAccuracy`, `RULES.exitAccuracy` |
| "practice-speed" (accurate but slower than target) stays on the same worksheet | `RULES.requireSpeedToAdvance = true` |
| Set names, generators and target times per set | `lib/mastery/curriculum.js` |
| Streak day = daily goal met in the learner's time zone; today not yet met doesn't break it | `computeStreak()` |
| Repeating a worksheet uses a new variant (new numbers) | `startWorksheet()` (variant = attempts so far) |
| Earlier worksheets stay open for review; review attempts never move placement | `submitAttempt()` |
| Physics uses g = 10 N/kg (stated in questions); periodic groups numbered 1–8 | `generators/science.js` |
| Instructors (role) may print any ready worksheet; linked instructors can view + place but not administer | `policy.js` |

## Limitations

- **Spec gap:** see above. Set lists beyond what the brief names are my design.
- **Curriculum depth:** the set lists/titles beyond what the brief names are my design, and levels J–O each have 2–3 sets of fairly short generators (see `math_advanced.js`); content review by a maths teacher is recommended.
- **Existing 5-worksheet progress:** learners whose saved position says worksheet 6–10 never existed before; positions ≤ 5 are unaffected. Worksheets 6–10 of every set are new (they use new seeds), so previously completed sets are not re-opened.
- **No service worker:** the app must be loaded online; a worksheet can be finished offline.
- **Rate limits are per server instance** (in-memory); on serverless they damp abuse but are not global quotas.
- **Answers are sent to the browser** so checking works offline; a determined learner could read them in DevTools. Placement still requires submitting correct answers, and the server re-grades.
- **Duration** is client-measured (for offline) but bounded by server time since the sheet was issued.
- **Reminders** are an `.ics` calendar event plus a stored time; there is no scheduled email/push sender (no job runner in this project).
- **Email sharing** relies on the existing SMTP config in `email-templates/config.js` (credentials there are pre-existing and hard-coded — recommend moving to env vars).
- **Pre-existing risks not changed** (flagged): Stripe test secret key hard-coded in `next.config.js`; remaining legacy routes that only check for the presence of an Authorization header (see *Security fixes made*). The password-hash exposure through `/api/users/update` and `/api/students` **was fixed** on 2026-10-14.
- `next start` uses the production DB config (`NODE_ENV=production`); run local E2E against `next dev`.

## Manual testing steps

**Parent (any signed-in account)**
1. Account menu → *Family dashboard* → *Add learner* (name, avatar, subjects, PIN).
2. Check tiles, subjects table, habit grid and chart (empty at first).
3. *Change placement* → choose level/set/worksheet → tick the confirmation → *Confirm*.
4. Set daily goal / reminder time → *Save*; *Add daily reminder to calendar* downloads an `.ics`.
5. Toggle *Adult learner mode*; reset the PIN; try *Reset progress* (needs the typed name).
6. *Share progress*: send to an address, or *Open in my email app*.

**Student**
1. Account menu → *Mastery Ladder* → choose the profile → enter PIN (5 wrong → locked).
2. Click a locked worksheet circle — not a link; visiting its URL shows "This worksheet is locked".
3. *Start worksheet*: answer with keyboard or keypad; a wrong answer must be corrected; watch the timer vs target.
4. Open *Ask Sage* → replay / explain / example.
5. *Leave* → *Save & leave* → return: resumes. *Abandon* discards without recording.
6. Finish → results (stars, accuracy, time, next action). Repeat offline (DevTools) to see the sync banner.

**Instructor**
1. Parent adds the instructor's email under *Access & safety* (relation *Instructor*).
2. Instructor's *Family dashboard* shows the learner; placement allowed; PIN/adult-mode/danger zone hidden and refused by the API.
3. *Print worksheets* → *No learner (teacher copy)* → any ready worksheet with answer key.

**Admin**
1. Admin sidebar → *Mastery Ladder*: Overview (presence), Learners (*Manage* opens any dashboard), Users & roles, Access rights (create a role, assign it), Audit log, Feedback (with screenshot), Sage tutor, Global reset (phrase + password).
2. Sign in as a non-admin and open `/admin/mastery/` → *Access denied*.

## Next steps

1. Supply the full Mastery Ladder spec; reconcile `RULES` and `curriculum.js`.
2. Add generators for Math J (remaining), K–O.
3. Set `ANTHROPIC_API_KEY` and smoke-test Sage with a real key; tune the system prompt.
4. Run `yarn migrate && yarn seed` on each environment (additive).
5. Browser click-through of the manual steps above (mobile 360 px included).
