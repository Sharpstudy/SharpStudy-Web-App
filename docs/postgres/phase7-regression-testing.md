# Phase 7: application regression testing on PostgreSQL

Everything lives in `tests/e2e-pg/`. None of it is part of `yarn test` (it needs running servers and a browser).

## How isolation is guaranteed

* **Writes go to a throw-away schema**, never to `public`. `provision.mjs create` builds `ss_e2e_<random>` from the same SQL as the migrations, copies the migrated data into it (`INSERT ... SELECT` from `public`, read-only on `public`) and adds dedicated test accounts (`e2e.*@example.test`).
* The test server and the scripts are pinned to that schema with `PG_SEARCH_PATH` (`database/config/config.mjs`); `public` is not on the search path, so a missing table is an error, never a silent fallback to real data. `provision.mjs drop` removes only the schema recorded in its state file.
* **MySQL is never written.** The comparison instance loads `server-preload.cjs` with `E2E_MYSQL_READONLY=1`, which makes every MySQL session `READ ONLY` on the server. The existing e2e scripts (which talk to MySQL directly) run through `mysql2-shim.mjs`, which only talks to the test schema.
* **No e-mail is delivered**: `server-preload.cjs` replaces nodemailer by a recorder. Stripe and Anthropic keys are not given to the test server.
* The test copies are built from a snapshot of the working tree (no `.env`, no secrets), so the normal dev server (port 3000, `.next/`) is never touched.

## Files

| File | Purpose |
|---|---|
| `provision.mjs` | create / drop the isolated schema (+ test accounts) |
| `fixtures.mjs` | picks real record ids (admin, instructor, student, course, learner) for the sweeps |
| `server-preload.cjs` | mail recorder, optional MySQL read-only guard, optional exact PostgreSQL query counter |
| `mysql2-shim.mjs`, `hooks.mjs`, `register.mjs`, `run-e2e.mjs` | run the existing `tests/e2e/*.mjs` against the PostgreSQL schema |
| `api-sweep.mjs` | every `pages/api` route x 4 roles x valid / unknown / malformed id (GET, POST, PUT, DELETE) |
| `api-scenarios.mjs` | sign-up, sign-in, confirmation, authorization, admin / instructor / student flows |
| `compat-diff.mjs` | same read-only requests to PostgreSQL and read-only MySQL: binary, JSON, timestamps, pagination, slugs, malformed ids |
| `perf-compare.mjs` | response times and exact database query counts, PostgreSQL vs MySQL |
| `browser-suite.mjs`, `overflow-compare.mjs` | headless Chrome checks per role and viewport |

## Known limits of this setup

* `next dev` is used for the live instances: the production build selects the `postgres_production` configuration (TLS required), which the local PostgreSQL does not offer. The production build itself is compiled and its bundles compared with the original code.
* Long `next dev` sessions can run out of memory; restart the instance with `--max-old-space-size=4096`.
