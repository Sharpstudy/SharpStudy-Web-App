# Family & child devices

Implements the parent / child flows of `docs/redesign/Sharp Study · Learn Together — Login UX.pdf` (18 screens: 9 phone, 3 tablet/desktop
parent screens, 2 desktop sign-in variants, 1 desktop child join, 3 phone sign-in/pair/approval variants).

## Model: reuse, don't duplicate

| Concept | Implemented as |
|---|---|
| Parent / family | the existing account (`users`); the family is "the children this account owns or is a `parent` guardian of" |
| Child | an existing `ml_learners` row (Mastery Ladder). Progress, assignments and worksheets are therefore the child's real records |
| Caregiver | an existing `ml_learner_guardians` link, relation `parent` |
| Child's session | the existing signed learner token (`typ: ml_learner`) with a device id claim (`did`) |
| Who is a parent | an `ml_learner_guardians` row with relation `parent` for that exact learner, created by redeeming a link code that the parent requested and the child generated (below). Parents hold no `learners.create`, no role and no ownership |

New tables (migration `20261023000000-family-child-devices.js`, additive and reversible): `fam_pins`, `fam_pairing_codes`, `fam_devices`,
`fam_device_learners`; plus four nullable columns on `ml_learners` (`age_band`, `picture_hash`, `picture_failed_attempts`, `picture_locked_until`).

## Route map (PDF screen → route)

| PDF screen | Route | Notes |
|---|---|---|
| Parent sign-in (phone, tablet, desktop), Create a parent account | `/auth?for=family&next=/family/setup/` | existing `LoginForm` / `RegisterForm` inside the family layout; the plain `/auth` is unchanged apart from a link to child pairing |
| Link your child (1 of 3) | `/family/setup/` step 1 | `components/Family/Setup.js`, `LinkChild.js`: request a code with the child's sign-in e-mail, then enter the code the child reads out. Reached from **Link my child** on `/family/`. No profile creation |
| Set a family PIN (2 of 3) | `/family/setup/` step 2 | 4–6 digits |
| Pair a device (phone) / Pair a device for Maya (desktop) | `/family/setup/` step 3, and the panel on `/family/manage/` | `components/Family/PairDevice.js` |
| A new device wants to join as Maya | inline in the pair panel; a sheet on `/family/manage/` when no panel is open | `ApprovalCard` / `ApprovalSheet` |
| Family (phone / tablet / desktop) | `/family/manage/` | linked children, devices + Revoke, Family PIN, Link my child (code), picture code |
| Let's join your family (phone / desktop) | `/learn/join/` | code pre-filled from `?code=` but never auto-submitted |
| Ask your grown-up to say yes! | `/learn/join/` (waiting state) | polls the server |
| You're in, Maya! | `/learn/join/` (success state) | only after the server reports `approved` |
| Who's learning today? | `/learn/` | device children only |
| Tap your 3 secret pictures | `/learn/` (picture state) | skipped for a child without a picture code |
| Hi Maya! + My learning journey | `/learn/` | real subjects, positions and assignments from `/api/mastery/study/home` |
| Grown-ups only | `/learn/pin/` | switch child / leave child mode / unpair |
| (worksheets) | `/learn/worksheet/` | the existing player, re-exported; links stay under `/learn` |
| Progress (nav) | `/family/` (existing Mastery family dashboard, unchanged) | |

## API

Parent (account token): `GET /api/family`, `POST /api/family/link` (redeem a code: the body carries only `{ code }`), `PATCH /api/family/children/[id]` (picture code only), `PUT /api/family/pin`,
`POST /api/family/pairing`, `GET|DELETE /api/family/pairing/[id]`, `POST /api/family/devices/[id]` (`approve` | `deny` | `revoke` + `confirm:true`).
Child's own signed-in account: `GET /api/family/link/code` (`{ eligible, learner }`: whether the account has a learner profile; never a code), `POST /api/family/link/code` (no body is read; generates a code for the learner attached to the account and returns it once), `DELETE /api/family/link/code` (withdraw the open code). The GET also returns `openCode` (expiry only) and the first names of linked parents, so a child can spot a link they did not intend. Shown on the student Family page (`/family/` for a child account, `components/Family/StudentFamily.js`) by `components/Family/ParentLinkCode.js` ("Show parent link code"); it is no longer part of the Mastery Ladder `/study/` page.
There is no instructor, administrator or parent endpoint that creates a link code (`POST /api/family/link/issue` was removed), and no parent endpoint that creates a learner, searches for one, or lists learners.
Child device (header `x-device-token`): `POST /api/family/device/join` (public, rate limited), `GET .../status`, `POST .../session`,
`POST .../grownup`, `POST .../unpair` (also `x-grownup-token`).

## Security

- **Authorisation on the server only.** Every parent call re-loads each child with `loadLearner(..., "admin")` and then requires an active `parent` guardian link (`isParentOf`). Another family's child, code or device is a 404. Body fields such as owner, family, role or approval flags are never read. A paired device belongs to the parent who paired it, not to the learner's owner.
- **Parent linking** (no instructor or administrator approval): the learner is identified by the child's OWN account (`ml_learners.student_user_id`, set only by an instructor), never by name or learner id. The parent never names a child (there is no e-mail, name or learner-id input anywhere in the parent UI or API). The signed-in child account clicks *Show parent link code* on their student Family page (`/family/`); the server looks up the learner attached to that account and generates the code for that learner only (nothing in the request body is read, so a parent or any other account cannot generate a code for a learner; an account with no learner profile gets 404 `no_profile`). 8 characters (32^8) from `crypto.randomInt`, only its HMAC is stored (separate label from pairing codes), the plain code is returned once and cannot be shown again (the child makes a new one, which cancels the older open code). 72 h expiry from creation of the code (`FAMILY_LINK_TTL_HOURS`). The parent enters the code on Family Setup; `redeemParentLink` resolves the learner from the stored code, so the parent's `{ code }` is the only input. Redeeming (`repo.redeemLinkCode`): ONE transaction that locks the code and learner rows, decides every rejection first (unknown/expired/used/cancelled, issuer is not the learner's CURRENT `student_user_id`, the redeemer is the learner's own account, owns the learner, or holds an instructor link) and only then marks the code used and inserts the `parent` guardian row, so a rejection or a failed insert never consumes the code. Unlinking a student (`unlinkStudentProfile`) also cancels the learner's open codes. Single use, idempotent for the account that redeemed it, one answer for every bad code (unknown, expired, used, replaced), rate limited per account and address (route) and 10 codes per learner per day (service). Redeeming adds one `parent` guardian row and changes nothing else (no ownership, enrolment, course, worksheet, progress, PIN or device change). No instructor or administrator approval is involved. Codes have `issued_by` = the child's account.
- **Unintended parents.** A code is a bearer secret: whoever holds it and is signed in can link, because the server cannot know which parent the child meant. Mitigations: only the child can create it; it is shown once; 72 h expiry; single use; a new code or *Cancel code* invalidates the old one at once; the child sees who is linked; 32^8 code space with per-account and per-address rate limits on redeeming. Residual risk: a code read out in front of others, or shared in a chat, can be used by that other person until it is used, cancelled or expired.
- **Removed e-mail flow.** `/api/family/link/request`, `/requests`, the `requested_by` column use and the `replaced` status are gone from the code. Migration `20261025000000-parent-link-requests.js` was uncommitted and its file removed; a database that already applied it keeps an unused nullable `requested_by` column and a nullable `code_hash`, which the code tolerates.
- **Privacy.** `GET /api/mastery/learners/[id]` returns the guardian list (with e-mail addresses) and the recorded profile/contact details only to staff (`learners.create` / `learners.manage_all`). A linked parent gets the learning data without them.
- **Limit**: a learner without a linked student account cannot be linked this way; an instructor links the student account first (Instructor → Students).
- **Family PIN**: bcrypt, 4–6 digits (strings only), 5 failures → 10 minute persisted lockout, wrong/locked answers never describe the PIN.
  Changing it needs the current PIN or the account password. Required before a device can be paired.
- **Pairing codes**: 6 chars from a 32-symbol alphabet (no I, O, 0, 1) via `crypto.randomInt`; only an HMAC-SHA256 is stored; 10 minute expiry
  (`FAMILY_CODE_TTL_MIN`); single use enforced by a locked transaction plus a unique `pairing_code_id` on `fam_devices`; unknown, expired,
  used and cancelled codes all return the same answer; redeeming is rate limited (8/min, 60/h per address). A redeemed code grants nothing until a parent approves.
- **Device secret**: 256 random bits shown once to the device, stored as SHA-256, compared in constant time. `pending` expires after 10 minutes.
  Approval/denial/revocation are compare-and-set so two taps cannot both win.
- **Revocation**: the device row is the authority. `getLearnerActor` re-checks the device on every request made with a device-bound learner token,
  so a revoked device's session stops working immediately (verified with HTTP 401 in the browser run). Revoking needs `confirm: true`.
- **Child sign-in**: optional 3-picture code (729 combinations), bcrypt hashed, 5 failures → 10 minute lockout per child, plus a per-address rate limit.
  Picture codes are deliberately weak secrets for young children; they only unlock a child's learning profile on an already-approved device.
- **Grown-ups only**: the PIN yields a 5 minute token bound to that device; unpairing needs it.
- **Privacy**: a child has a nickname, avatar and age band (no name, birthday or e-mail). Device status returns names/avatars only. Logs contain no codes, PINs or tokens.

## Differences from the reference (and why)

- **Continue with Google / Face ID / Forgot password?** are not shown: the app has no Google sign-in, no passkeys and no routed password-reset page. Nothing was faked.
- **"Use this iPad for a lesson · Child mode"** (tablet Family screen) is not built; a parent's own device is paired like any other device.
- **Fonts**: the child screens use *Baloo 2* (closest free match to the display face in the PDF); body text is Plus Jakarta Sans, as in the PDF.
- **"Forgot? … they can see it in Family"**: picture codes are stored hashed and cannot be shown, so the copy says a grown-up can *reset* it in Family.
- **Grown-ups PIN screen** shows 4 dots that grow to 6 and has an *Unlock* button, because the PIN is 4–6 digits (the reference shows 4 dots, no button).
- **Online / last seen** is per device and comes from the device's polling (every 20 s while the child app is open).
- **Start an activity from the parent's phone** ("Waiting for your grown-up to start") is driven by the existing assignments: an assigned worksheet appears on the child's home with a Start button.
  A live remote-start channel was not added.

## Parent-only experience (Progress and Family only)

There is no parent role: a parent is a `student`-role account with an active `parent` guardian link. `lib/family/parentMode.js` (`isParentOnly`) treats an account as parent-only when it is a student, is a parent of at least one learner, is not itself a learner's linked student account, and has no paid course enrolment or paid book order. `GET /api/users/update` computes this from the database on every request and returns it as `is_parent`; nothing comes from the browser.

- **Page gate (server):** `lib/auth/pageAccess.js` sends a parent-only account to `/family/` from every page except `/family/*`, the legal pages and the error pages (so `/`, `/explore`, courses, books, `/study`, `/learning`, `/profile`, `/print`, `/instructor`, `/admin`, `/auth` all redirect). It runs in `pages/_app.js` `getInitialProps` for the first request and for every client navigation. Anonymous visitors are sent to `/auth` by the existing protected-route list.
- **Layout:** `components/Family/FamilyShell.js` shows only Progress and Family plus **Logout** for `is_parent`, and the logo goes to `/family/`. Other users keep the four-item navigation. Logout (`handleParentLogout`) removes the token cookie, clears any learner session and goes to `/auth?for=family`.
- **Landing:** parent registration and login go to `/family/` (Progress). After a successful link code the browser goes straight to `/family/`; the Family PIN and device-pairing steps are no longer part of linking. They remain on the Family page and at `/family/setup/?step=2|3`, reached on purpose.
- **APIs:** unchanged. Data isolation is by link (`isParentOf`, `loadLearner`); instructor and admin APIs check the role on the server. Parent-only status only affects which screens render.
- **Limits:** a parent who has registered but not linked a child yet is indistinguishable from a new student, so is not restricted until the first link. Making that earlier needs an `account_type` column (a schema change that has not been made).
