# Live sessions: implementation notes, Jitsi security, deployment

## Model

- A **session** is one row of `lc_classes` (stable UUID, owning `instructor_id`, `course_id`, `session_type` group/one_to_one, `capacity`, UTC `start_at`/`end_at` plus the original `time_zone`, `status`, random `room_name`).
- A **seat** is a row of `lc_enrolments` (unique per session and participant). A one-to-one session is a slot with capacity 1; "booking" is taking that seat.
- **Attendance** is `lc_attendance`, one row per participant per session (unique key), so reconnects never create duplicates.
- **Live questions** link to a session through `live_questions.class_id`. `class_id IS NULL` means the original course-level class, which still works.

## Access rules (all enforced in `lib/live-sessions/service.js`)

| Action | Allowed when |
| --- | --- |
| Create / reschedule / cancel / end | Role is `instructor` or `admin` (re-read from the DB on every request) and the caller owns the session (admins may manage any). Creating also requires owning the course. |
| Take a seat | **Paid** enrolment (`enrolments.status = 'paid'`) in the session's course; session not cancelled/completed; seats left; no overlap with the student's other sessions. Takes row locks, so concurrent requests cannot oversell. Never charges anything. |
| Join | Owner/admin, or seat holder who still has a paid enrolment, inside the join window (students 10 min before start to 30 min after end; instructors 30 min before). Re-validated on every join; the room name is only returned here. |
| Live questions | Instructor of the session / seat holder with paid enrolment; publishing and answering only while the session is `live`. Everyone else gets 404. |

Buying a course gives no access to any session by itself: it makes group sessions visible and bookable, and one-to-one slots bookable until someone takes them.

## Jitsi: what is and is not guaranteed

The deployment uses the public `meet.jit.si` (override with `JITSI_DOMAIN`). Application-level checks protect **our** doors, but the public instance does not know about our users:

- Room names are random (`ss-` + 32 hex characters, ~128 bits) and are revealed only to authorized users by the join endpoint, so they cannot be guessed or derived from a course slug.
- Anyone who **obtains** the room name (for example a participant who shares it) can still enter it. On public Jitsi, rooms are not access-controlled; there is no per-user lock.
- The legacy course-level class (`/learning/course/class/[slug]`) still uses the course slug as the room name and has no server-side join check. It is unchanged on purpose; new live teaching should use scheduled sessions.

For real enforcement you need your own Jitsi deployment with **JWT authentication** (`prosody` token auth plus `lobby`/`moderator` roles). The join endpoint is the right place to mint a per-user, per-room JWT; `lib/jitsi/mount.js` would pass it as the `jwt` option. This is not implemented because no self-hosted Jitsi or app id/secret exists in this repository.

## Deployment checklist

1. Run migrations: `npm run migrate` (restores `20261013000000-create-live-classes` guarded by `tableExists`, then `20261018000000-add-live-session-fields`). Both are additive and do not drop anything.
2. Optional: set `JITSI_DOMAIN` (and make sure the `external_api.js` script is served from that domain).
3. No new environment secrets and no new infrastructure. Live questions keep their existing polling (2.5 s, 8 s when the tab is hidden).

## Known limitations

- Leaving by closing the tab cannot call the API; the stint is closed when the instructor ends the session (or the window passes) and capped at 6 hours.
- No e-mail/notification when a session is cancelled or rescheduled; students see the new state in the list.
- The rate limiter is in memory per server instance.
- Instructors cannot assign a specific student to a private session; the student books a slot they are eligible for.
- The unused `lc_quiz_*` tables of the earlier schema exist in the dev DB and are not recreated by the restored migration.
- Rooms are not private against someone who is given the room name (see Jitsi section).

---

# Update: assigned students, notifications, answer keys, picture questions

## Assigning students
`POST /api/live-sessions` accepts `studentIds`. They are re-checked on the server: each must hold a **paid** enrolment in the chosen course (owned by the caller), and cannot be the instructor. One-to-one needs exactly one student; a group may have several (never more than its seats) or none (open booking by the course's students, as before). Assigned sessions have `enrollment_mode = 'assigned'`: only those students see, join or get attendance for them; classmates get 404/403. The instructor, every assigned student and (on reschedule) every participant are locked in a fixed order inside one transaction, so neither the instructor nor a student can be double-booked, even by two instructors at once. `GET /api/live-sessions/students?courseId=&q=` feeds the picker and only returns paid students of a course the caller owns.

## Notifications
Table `notifications` (unique `dedupe_key`). Events: assigned, rescheduled, cancelled (created by the API after the change is saved) and a reminder (created lazily, in-app only, when a student opens their notifications within 24 h of the start — there is no scheduler). E-mail uses the existing `lib/meetings/mailer.js` (SES SMTP via `AWS_SES_USER`/`AWS_SES_PASSWORD`), only for users with `email_confirmed`, and only for a newly created notification, so retries never e-mail twice. The outcome is stored in `email_status`. A mail or notification failure is swallowed and never undoes the session. Students see notifications on **Live sessions** and **My courses**.

## Answer keys (root cause)
Every stored question had `correct_option_id = "o1"` (the first option). The composer pre-selected option 1 and the server turned a missing key into 0 (`Number(null)`, `Number("")`). The key must now be chosen explicitly (editor starts with none selected; server accepts only an integer or digit string in range), is stored as a stable option id, and every grade is derived from it. Existing keys were **not** changed. `node scripts/audit-live-question-keys.mjs` lists them read-only; an instructor corrects one question at a time with "Wrong answer marked? Fix it" (re-grades that question only).

## Picture questions
The editor supports multiple choice (text and/or pictures), True/False and a picture/diagram on the question. There is no private file store configured (course uploads go to a public Cloudinary preset), so images are stored in `live_question_images` (MEDIUMBLOB) and served only by `GET /api/live-questions/<session>/images/<id>`: PNG/JPEG/WebP/GIF by content, max 1 MB, SVG refused, max 40 per session; students can read an image only after a question using it is published in their session. Uploads are base64 JSON. This suits classroom-sized diagrams, not large media.

## Migration
`20261019000000-live-session-assignment-notifications-images.js` (additive): `lc_classes.enrollment_mode`, `live_questions.image_id`, `live_question_images`, `notifications`.
