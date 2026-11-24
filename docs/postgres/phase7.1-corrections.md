# Phase 7.1: final PostgreSQL compatibility corrections

## Code corrections
| Area | Change | Why |
|---|---|---|
| Slug look-ups (courses, books, categories, quizzes; 8 sites) | `ciEquals(connection, "slug", slug, Model)` from `lib/db/dialect.js` | MySQL matched slugs ignoring case, PostgreSQL did not. The column is qualified with the model name because joins (course + category) both have `slug`. MySQL behaviour is unchanged (plain `{ slug }`). |
| Family / learner pages at 390-440 px | `position: relative` on `.ss-table-wrap` (`styles/sharpstudy/_components.scss`) | Visually-hidden `.ss-sr-only` labels (absolutely positioned) inside the scrolling table wrapper were not clipped by it and widened the page to 570 px. Database independent. |

## Test corrections (stale assumptions, evidence in each script)
* `learner-identity`: the picker lists owned + guardian-linked + student-linked learners.
* `live-questions`, `jitsi-single`: an enrolment needs `status = 'paid'` to count (docs/live-sessions/02).
* `meetings-ui`: home call-to-action is now "Talk to our team"; the check also had a template-string escape bug (`\S`).
* `nav`: a student opening `/family/` gets the family shell (`fm-nav`), not the global header.
* `student-directory`: uses only dedicated `e2e.*@example.test` students without learner profiles (a real student has a profile with progress); skips if fewer than four exist. `provision.mjs` now creates `e2e.child`, `e2e.parent-a`, `e2e.parent-b`.
* `ui-visual`: children of the closed, fixed `.ss-drawer` are not overflow offenders.

No authorization or ownership rule was changed.

## New tests
* `tests/db/*`: slug tests for both dialects (helper SQL, real handlers on PostgreSQL, read-only MySQL).
* `tests/e2e-pg/family-overflow.mjs`: headless Chrome, 3 pages x 390/414/440/768/1366 px.
* `tests/e2e-pg/browser-probe.mjs`: now measures against the intended width (a too-wide page enlarges the layout viewport) and accepts `PROBE_EXTRA`.

## Production-mode (TLS) verification
Production mode selects `postgres_production`, which requires TLS with certificate verification. It was verified on a throw-away PostgreSQL 18 cluster (own data directory, port 55432, `hostssl` only, self-made CA + server certificate for `localhost`), holding a copy of `public` made with `pg_dump` (read-only on the real database). `next build` + `next start` ran with `NODE_ENV=production DB_DIALECT=postgres` and `PG_*_PROD` variables; connections were TLSv1.3. A second server given a different CA was refused ("unable to verify the first certificate"). Production configuration was not modified.
