# Authentication, account states, password reset and Google sign-in

## Telecaller account states (the Student-dashboard bug)

**Root cause.** A telecaller is a `users.role = 'student'` row plus rows in `telecaller_applications` / `telecaller_profiles`. The home-page
redirect (`lib/auth/landing.js`) only recognised an *active* telecaller; every other applicant state (draft, pending, more information,
rejected, deactivated) fell through to `dashboardHome('student')` = `/learning/my-courses/`. The page gate (`lib/auth/pageAccess.js`) and the
navigation (`components/_App/accountLinks.js`) had the same blind spot, so a pending applicant was an ordinary student everywhere.

**Fix.** One pure function, `lib/auth/telecallerState.js`, turns the database facts into a state. `/api/users/update` computes it from the
database (`telecaller_state`), `lib/auth/telecallerAccess.js#telecallerStateFor` computes it for the landing redirect.

| State | Landing after sign-in | Student areas (`/learning /study /family /print /checkout`) | `/telecaller/` | Navigation |
|---|---|---|---|---|
| none (ordinary student) | My Learning | open | closed | student |
| draft | `/become-a-telecaller/` | open | → status page | student |
| pending / more_info | `/become-a-telecaller/` | **closed** → status page | → status page | Telecaller Application, Account Settings |
| rejected | `/become-a-telecaller/` | open | → status page | student |
| active | `/telecaller/` | closed → `/telecaller/` | open | Telecaller Dashboard, Account Settings |
| inactive (deactivated, or approved without a profile) | `/become-a-telecaller/` | **closed** → status page | → status page | Telecaller Application, Account Settings |

Admins and instructors are never held in the applicant experience. Telecaller **APIs** were already independent of the page gate: every call
re-reads the user and `telecaller_profiles` (`lib/followups/service.js#access`) and refuses applicants, deactivated telecallers and ordinary
students with 403.

## Database migration (additive, reversible)

`database/migrations/20261110000000-add-auth-security-columns.js` (MySQL) and
`database/migrations-pg/20261110000005-pg-add-auth-security-columns.js` (PostgreSQL) add seven nullable / defaulted columns to `users` and two
unique indexes. Nothing is dropped or rewritten; `down()` removes only what `up()` added.

| Column | Purpose |
|---|---|
| `password_reset_token_hash` | SHA-256 of the one-time reset token (the token itself is never stored) |
| `password_reset_expires_at`, `password_reset_requested_at` | expiry (60 min) and per-account throttle |
| `password_changed_at` | tokens issued before it are rejected (signs out every older session) |
| `failed_login_count`, `locked_until` | per-account sign-in lockout, shared across servers |
| `google_sub` | Google's stable id once an account is linked |

The e-mail confirmation columns (`reset_password_token`, `reset_password_send_at`) are untouched and not reused.

**Run it before deploying the new code to an environment**: `npx sequelize-cli db:migrate` (MySQL) or
`npx sequelize-cli db:migrate --env postgres_development`. Until it is applied, sign-in keeps working (lockout and revocation are skipped when
the columns are missing), but forgot-password and Google sign-in answer 503.

## Forgot / reset password

`/forgot-password` → `POST /api/users/forgot-password` → e-mail with `/reset-password?token=…` → `POST /api/users/reset-password`.
256-bit CSPRNG token, hash stored, 60-minute expiry, single use (one atomic UPDATE), newer request replaces the older token. Same answer for
known / unknown / disabled / throttled addresses. Limits: 10 requests/h per client address (429), 3 e-mails/h per address (silently the same
answer), 1 e-mail/min per account. A reset stamps `password_changed_at`, clears the lockout, and e-mails a "password changed" notice.
New passwords: ≥ 8 characters, a letter and a number, ≤ 72 bytes, not common, not the e-mail (existing passwords keep working).

## Sign-in hardening

* One generic `401 Invalid email or password.` for unknown address, wrong password and locked account. "E-mail not confirmed" and "account
  disabled" are only reported after the **correct** password.
* 30 attempts / 15 min per client address (429); 8 wrong passwords in a row lock the account for 15 minutes (cleared by a successful sign-in or a reset).
* Sign-up no longer returns a token: the person confirms their e-mail first (the page offers "send again", rate-limited and non-revealing).
* `getAccountActor` (used by the protected APIs) now also refuses an unconfirmed account and a token older than `password_changed_at`.

## Google sign-in

Google Identity Services ("Sign in with Google" button) returns a signed **ID token**; `POST /api/users/google` verifies it on the server
(`lib/auth/googleVerify.js`: RS256 signature against Google's published keys, issuer, **audience = our client id**, expiry, kid; `email_verified`
must be true). Only the token is read from the request. Existing account whose e-mail is **confirmed** → linked (`google_sub` only; password, role
and everything else untouched; never duplicated). Existing account whose own e-mail was **never confirmed** → **refused** (409 `account_unconfirmed`) and left
unchanged: someone else may have registered that address with a password only they know, so silently confirming or replacing it would be unsafe. The owner
uses **Forgot password** (the explicit process that replaces the password *and* confirms the e-mail), then continues with Google. New address → ordinary
`student` account, confirmed, unusable password. Google never sets role, telecaller, instructor or admin state; a Google user applies for telecaller access like anyone else.

### Environment variables (names only; never commit values, `.env` is not touched by this change)

| Variable | Where | Value |
|---|---|---|
| `GOOGLE_CLIENT_ID` | server | OAuth client id (`…apps.googleusercontent.com`) |
| `NEXT_PUBLIC_GOOGLE_CLIENT_ID` | browser | the same client id (public by design) |
| `GOOGLE_CLIENT_SECRET` | – | **not used** by this flow (ID-token flow). Only needed if you later add a redirect / code flow |
| `JWT_SECRET`, `AWS_SES_USER`, `AWS_SES_PASSWORD`, `BASE_URL` | server | already used elsewhere; the reset e-mail needs the SES pair and `BASE_URL` for its link |

### Google Cloud Console

1. https://console.cloud.google.com → create / choose a project → **APIs & Services → OAuth consent screen**: user type External, app name, support e-mail, authorised domain `sharpstudy.io`; scopes `openid`, `email`, `profile`; add test users while in *Testing*.
2. **Credentials → Create credentials → OAuth client ID → Web application**.
3. **Authorised JavaScript origins**: `http://localhost:3000` (development) and your production origin (e.g. `https://sharpstudy.io`, plus the Vercel URL if used). No redirect URIs are required for this popup / ID-token flow.
4. Copy the client id into `GOOGLE_CLIENT_ID` and `NEXT_PUBLIC_GOOGLE_CLIENT_ID`; restart the server (the public one is inlined at build time).

## Backend isolation of the student experience (API gate)

`getAccountActor` (`lib/mastery-server/http.js`), the one place every authenticated API resolves its caller, now also reads the caller's telecaller
state from the database (never the JWT role) for the student-content API areas listed in `lib/auth/apiPolicy.js`, and treats a `role = student`
account in state **pending, more_info, inactive or active** as signed out there (401 on required routes; optional-actor routes behave as anonymous).
`tests/auth/api-gate.test.mjs` fails if a new folder appears under `pages/api` without an explicit decision.

| Account (role student unless stated) | Student-content APIs (`/api/learnings /mastery /family /books* /checkout /wishlist /favourites /subscriptions /quizzes/student /live-sessions /live-questions /assets /courses/course`) | Shared (`/api/users/*`, `/api/notifications`, `/api/meetings`, public catalogue) | `/api/telecallers/apply` | `/api/telecaller/*` | admin APIs |
|---|---|---|---|---|---|
| ordinary student | yes | yes | yes | 403 | no |
| draft / rejected applicant | yes | yes | yes | 403 | no |
| pending / more_info applicant | **401** | yes | yes | 403 | no |
| deactivated telecaller | **401** | yes | yes | 403 | no |
| active telecaller | **401** | yes | yes | yes | no |
| instructor (any telecaller rows) | yes | yes | yes | 403 | no |
| admin | yes | yes | not eligible | read access | yes |
| unconfirmed e-mail / disabled / revoked token | 401 | 401 | 401 | 401 | 401 |

(*the public book catalogue routes ignore the caller, so they keep working for everyone.) "401" means "behaves exactly like a signed-out caller": routes that
answer signed-out callers with something else do the same for these accounts, e.g. `GET /api/mastery/me` returns `200 {"account":null,"learner":null}` to a
pending applicant (no account data), while an ordinary student gets their account. Routes that authenticate with a child-device / learner token
(`/api/family/device/*`, `/api/mastery/study/home|start`, `/api/mastery/tutor`) do not use the account token at all, so an account token gets 401 there for every account. A student with a pending application therefore cannot read
their own course / book / Mastery data until the application is decided; that is the requested behaviour and it is lifted if the application is rejected.
Fail-open note: if the telecaller tables cannot be read the state is "none", the same tolerance the rest of the app has for a missing table.

## Security review: current status

| Area | Status |
|---|---|
| JWT cookie | Script-readable (`utils/axiosAuth.js` copies it into the `Authorization` header). `SameSite=Lax`, `Secure` on https, 7-day expiry. XSS can still read it. |
| CSRF | The APIs read the token only from the `Authorization` header, never from the cookie, so a cross-site request cannot authenticate. That property is why no CSRF token exists today. **Before any move to HttpOnly cookies** the design must add: server-side cookie reading in every API and in `getInitialProps`, removal of the header copy in `axiosAuth.js`, and CSRF protection (SameSite=Strict/Lax plus a token or Origin check). Not done. |
| Revocation | A password reset / change stamps `password_changed_at`; older tokens are refused by `getAccountActor` and the landing redirect. No "log out everywhere" button. |
| Login rate limit | 30 / 15 min per client address, in memory per server instance (on serverless each instance has its own window: abuse damping, not a global quota). The address comes from `X-Forwarded-For`, which a client can spoof unless the platform overwrites it. |
| Account lockout | 8 wrong passwords → 15 minutes, stored in the database (holds across instances). Anyone who knows an address can lock that account for 15 minutes; the answer stays generic and Forgot password clears the lock. |
| E-mail verification | Enforced at sign-in and in `getAccountActor`. Sign-up returns no token. |
| Reset token | 256-bit random, hash only stored, 60-minute expiry, consumed by one atomic UPDATE, replaced by a newer request, never logged. A reset also confirms the e-mail. |
| Sign-up | Still reveals "user already exists" (usability); sign-in, forgot password and resend do not. |
| Password policy | New passwords only: ≥ 8, letter + number, ≤ 72 bytes, not common, not the e-mail. |

## Database migration: how to run it safely

`.env` here selects **PostgreSQL on localhost** (`DB_DIALECT=postgres`, database `sharpstudy_dev`; the production MySQL database has a different name). That
database holds the migrated working data, so rehearse on a throw-away schema first. The PostgreSQL migration is plain SQL relative to the connection's
`search_path`: an earlier version used Sequelize helpers that default to `public` and altered the wrong schema during a rehearsal (reverted; fixed).

Rehearsal in an isolated, empty schema (never writes to `public`):

```
npx env-cmd node tests/auth-db/schema.mjs create .ss-authtest.json        # prints ss_authtest_<hex>
export PG_SEARCH_PATH=ss_authtest_<hex>                                    # PowerShell: $env:PG_SEARCH_PATH = "ss_authtest_<hex>"
# once: mark the four 2026110100000x-pg-* baseline migrations as applied in <schema>.sequelizemeta (name varchar(255) primary key)
# verify the target: select current_schema(), to_regclass('users')  -> must show the test schema and an empty users table
npx env-cmd sequelize-cli db:migrate --env postgres_development           # applies 20261110000005 to the TEST schema only
npx env-cmd node --test tests/auth-db/auth-db.integration.mjs              # real-database tests
npx env-cmd sequelize-cli db:migrate:undo --env postgres_development      # optional: prove it is reversible
npx env-cmd node tests/auth-db/schema.mjs drop .ss-authtest.json          # drops ONLY that schema
```

To apply for real, only when you decide to: local/dev PostgreSQL `npm run migrate:pg` (no `PG_SEARCH_PATH`); production MySQL `npm run migrate` with the
production `DB_*` variables, after a backup. The MySQL migration was run on a **disposable local MySQL 8.0.45** (own data directory, port 3399, nothing from `.env`): the full history from an empty database, then
`db:migrate:undo` (columns and indexes removed), `db:migrate` again (restored) and a no-op third run. It has not been run against any existing MySQL database.
To repeat: `mysqld --initialize-insecure --datadir=<dir>`, `mysqld --datadir=<dir> --port=3399 --bind-address=127.0.0.1`, create a database, then run `sequelize-cli db:migrate`
with explicit `DB_USERNAME / DB_PASSWORD / DB_NAME_DEVELOPMENT / DB_HOSTNAME=127.0.0.1 / DB_PORT=3399` variables (not `env-cmd`, so `.env` is never read).

## Development only: verifying a test account without an e-mail service

Sign-in checks exactly one field, `users.email_confirmed` (`lib/auth/signinGuard.js`). The confirmation token (`reset_password_token`) is **not** needed to sign
in; it only proves, through the e-mailed link, that the person owns the mailbox. `email_confirmed_at` is written by the link but never read.

```
node scripts/dev/verify-test-account.mjs you@example.test          # dry run: shows what it would change
node scripts/dev/verify-test-account.mjs you@example.test --yes    # applies it
```

The script touches only that one account's `email_confirmed` / `email_confirmed_at`; never the password, role, status, token, or any telecaller application or
profile (it cannot approve anyone). It refuses unless `NODE_ENV` is not production, the database host is local, the database name ends in `_dev` or `_test`, and exactly
one account matches. Equivalent SQL (psql, development database only):

```sql
UPDATE users SET email_confirmed = true, email_confirmed_at = COALESCE(email_confirmed_at, now())
WHERE lower(email) = lower('you@example.test');   -- check "UPDATE 1"
```

Public registration is unchanged: real users still have to use the e-mailed link.

## Why a confirmed account can still land on My Learning

A telecaller applicant is recognised only by rows in `telecaller_applications` / `telecaller_profiles`. An account that has registered (even through
`/auth?intent=telecaller`) but has **not yet saved or submitted the application** has neither, so it is correctly an ordinary student and lands on My Learning.
The registration path hands the person to the application through the `next=/become-a-telecaller/` link carried by the confirmation e-mail; confirming by
hand skips that hand-off, so open `/become-a-telecaller/` yourself, save a draft or submit, and from then on sign-in lands on the application / status page.

## Known limitations

* No browser (UI) tests were run; the real-database tests cover services, repositories and gates, not rendered pages.
* No real e-mail was sent and no real Google account was used (test ID tokens are signed with a locally generated key; fetching Google's live keys is untested).
* The in-memory per-address limiter and the script-readable JWT cookie (see the table above).

## Manual / browser runbook (test accounts only)

1. Rehearse as above, then start a separate server on the test schema: `BASE_URL=http://localhost:3100 PG_SEARCH_PATH=<schema> npx next dev -p 3100` (Next loads `.env` itself). **`BASE_URL` is required**: `pages/_app.js` fetches `${BASE_URL}/api/users/update` on the server to run the page gate, and without it the fallback is `http://localhost:3000`; on any other port that fetch is refused and the gate **fails open** (pages render as for a signed-out visitor; the API gates still hold). The same applies in production: `BASE_URL` (or the Vercel URL variables) must point at the deployment itself. Use `@example.test` accounts; mails are skipped without SES credentials, so read confirmation links from `users.reset_password_token`, and for the reset flow install a known token hash (the raw token only ever exists in the e-mail).
2. Register a student; expect "Check your email" (no dashboard). Confirm, log in, expect My Learning.
3. Register a telecaller from `/become-a-telecaller`, confirm, log in, submit with a PDF. Expect Pending, `/learning/my-courses/` redirecting to the status page, and with its token `/api/learnings/progress` → 401, `/api/telecallers/apply` → 200.
4. Approve as admin; log in as the telecaller; expect `/telecaller/`, student APIs → 401, telecaller APIs → 200. Deactivate; expect the status page and 403 on telecaller APIs.
5. Forgot password and reset for each; the old password and old session must fail. Google needs a real OAuth client and a test Google account (not done).
