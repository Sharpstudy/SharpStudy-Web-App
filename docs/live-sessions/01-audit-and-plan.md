# Live sessions: audit and plan

## Audit (what exists today)

| Question | Finding |
| --- | --- |
| How do instructors create live classes? | `/instructor/course/create-class` reuses `CourseCreateForm` with `is_class`. A "class" is a **course**; there is no schedule, no time zone, no capacity, no session entity. |
| Course or student? | Course only. No one-to-one concept. |
| Purchase / enrolment check to join | `/learning/course/class/[slug]` has **no server check at all** to render or start Jitsi. Only the Live Questions API checks enrolment (any `enrolments` row, `status` ignored). |
| Jitsi room name | `slug` (the course slug) on public `meet.jit.si`. Guessable, shared by every class of the course, identical for any future one-to-one. |
| Room collisions | Yes: every session of a course shares one room; a course slug is public. |
| Student access | Opens the page, clicks "Start / Join class". Nobody is authorized by the server. |
| Attendance / scheduling / booking | **Dev DB has `lc_classes`, `lc_attendance`, `lc_enrolments`, `lc_quiz_*`** (SequelizeMeta lists `20261013000000-create-live-classes.js`) but the migration file, models and code are absent from the repo. Nothing reads or writes them. Decision: reuse `lc_*`, restore the migration (guarded) and extend additively. |
| Jitsi mount/cleanup | `lib/jitsi/mount.js` + `components/Learning/JitsiMeeting.js` already fix the StrictMode double iframe. Kept as is. |
| Live Questions | Exists (service, repo, 6 routes, panel, polling every 2.5 s, 188 passing baseline tests). Dev data shows complete open, closed, revealed runs with responses, so the transport works. |

## Live Questions: root causes found

I could not reproduce a hard failure at the service/API/data level (service tests pass, and dev data shows full flows). I did find structural defects that produce wrong behaviour in real classes:

1. **Questions are scoped to the course, not to a session.** Every class of a course (and every future session) shares one question stream. "Current question" is simply the last published question of the course, so a student joining tomorrow's class sees yesterday's question, and results/review mix different sessions.
2. **The room and the question stream are tied to the public course slug**, so there is nothing to attach a per-session membership check to.
3. `isEnrolled` accepts any enrolment row, ignoring `status` (`paid`/`unpaid`).

Fix: questions and responses are linked to a scheduled session (`live_questions.class_id`), and session membership is validated; the legacy course-slug route keeps working for questions with `class_id IS NULL`. Polling is kept (2.5 s, backs off when hidden; unique index makes retries idempotent), so no new real-time infrastructure.

## Plan

1. Migrations: restore `create-live-classes` (guarded by `hasTable`), add `add-live-session-fields` (type, capacity, `live_questions.class_id`).
2. `database/models/live_session.js` over `lc_classes`, `lc_enrolments` (seats), `lc_attendance`.
3. `lib/live-sessions/{service,repo}.js`: create, list, reschedule, cancel, seat booking (transactional, row-locked), join window, attendance, status transitions. Entitlement = ownership, or a **paid** course enrolment plus a seat. Room names are random, per session, server-issued.
4. Scope Live Questions by session (service + repo + memory repo).
5. API: `/api/live-sessions`, `/[id]`, `/[id]/seat`, `/[id]/join`.
6. UI: instructor `/instructor/live`, `/instructor/live/[id]`; student `/learning/live`, `/learning/live/[id]`. `LiveClassComponent` is reused (room and question scope become props).
7. Tests, lint, build; docs with the Jitsi deployment limits.
