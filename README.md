This is a [Next.js](https://nextjs.org/) project bootstrapped with [`create-next-app`](https://github.com/vercel/next.js/tree/canary/packages/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `pages/index.js`. The page auto-updates as you edit the file.

[API routes](https://nextjs.org/docs/api-routes/introduction) can be accessed on [http://localhost:3000/api/hello](http://localhost:3000/api/hello). This endpoint can be edited in `pages/api/hello.js`.

The `pages/api` directory is mapped to `/api/*`. Files in this directory are treated as [API routes](https://nextjs.org/docs/api-routes/introduction) instead of React pages.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js/) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/deployment) for more details.

---

# Mastery Ladder

A self-paced, worksheet-based learning ladder (Mathematics 7A–O, English E7A–EC,
Physics PH1–PH7, Chemistry CH1–CH7) built into the existing SharpStudy app. It
reuses the existing JWT login, Sequelize/MySQL, and the `ss-*` design system.
Detailed requirement → file → test mapping: `docs/mastery-ladder/IMPLEMENTATION_STATUS.md`.

## Architecture

```
lib/mastery/            Pure ES modules (no Next/DB imports) — unit tested with Node
  rng.js                FNV-1a seed hash + mulberry32; int / pick / shuffle
  curriculum.js         Subjects → stages → levels → sets; ladder order, unlock rules
  rules.js              Stars / status / progression rules (all tunables in RULES)
  generators/*.js       Question generators (math, english, physics/chemistry)
  sheet.js              generateSheet(levelId, setId, worksheetNo, variant)
  answers.js            Integer/decimal/fraction/text/choice/multi/expression checking
  expression.js         Safe polynomial parser for expression equivalence (no eval)
  grading.js            Server re-grading of the raw answer log
  habits.js             Family-local days, streaks, 21-day grid, day/week/month buckets
  offline.js            In-progress persistence + idempotent attempt queue
  policy.js             Permissions and per-learner access (view / place / admin)
  service.js            Learners, PINs, placement, study start/submit, dashboard, print, tutor
  admin.js              Users/roles, custom roles, audit, feedback, presence
  tutor.js              Sage tutor logic + answer-leak guard (AI client injected)
lib/mastery-server/     Next-only: Sequelize repo, HTTP helpers, Claude client (server-only)
lib/mastery-client/     Browser: API wrapper, safe localStorage, offline sync hook
pages/api/mastery/      Thin API handlers (all authorisation happens server-side)
pages/study, /study/worksheet, /family, /print, /admin/mastery    UI
database/models/mastery.js, database/migrations/20261012000000-create-mastery-ladder.js
```

Key guarantees:

- **Deterministic worksheets.** The same `(level, set, worksheet, variant)` gives the
  same questions on the server, in the player and on paper.
- **Server-authoritative progress.** `/study/start` only hands out unlocked
  worksheets and returns a signed start token. `/study/submit` regenerates that
  exact sheet, re-grades the raw answers, bounds the claimed duration by server
  time, and alone decides stars and placement. Client scores are ignored.
- **Idempotent sync.** Each finished worksheet has a client-generated
  `clientAttemptId`; `(learner_id, client_attempt_id)` is unique, and only the
  request that inserts the row may change placement. Concurrent devices on the
  same worksheet advance placement once (optimistic `version` on `ml_progress`).
- **Learner sessions.** A signed-in adult account picks a learner profile and
  enters its 4-digit PIN (bcrypt-hashed, 5 tries then a 10-minute lock). The
  resulting learner token is sent as `x-learner-token`.

## Environment variables

Existing variables are unchanged (`DB_*`, `JWT_SECRET`, …). New, optional:

| Variable | Purpose |
|---|---|
| `ANTHROPIC_API_KEY` | Enables Claude for the Sage tutor. **Server only** — read in `lib/mastery-server/ai.js`, never added to `next.config.js env`. Without it, Sage uses built-in lessons and worked examples. |

## Database

```bash
yarn migrate          # creates the ml_* tables (additive; existing tables untouched)
yarn seed             # idempotent defaults: tutor settings + "Support"/"Auditor" roles
```

Tables: `ml_learners`, `ml_learner_guardians`, `ml_subject_enrolments`,
`ml_progress`, `ml_attempts`, `ml_daily_activity`, `ml_hint_events`,
`ml_audit_logs`, `ml_feedback`, `ml_settings`, `ml_roles`, `ml_user_roles`,
`ml_presence`. Timestamps are UTC; `local_date` columns hold the learner's
family-local day (IANA time zone on the learner). `migrate:rollback` drops only
these new tables — never run it against production data you need.

## Tests

```bash
yarn test             # 59 unit/service tests (Node test runner, in-memory repo)
yarn dev              # then, in another terminal:
yarn test:e2e         # 46 HTTP checks against localhost + the development DB
```

The E2E script refuses non-localhost URLs, mints short-lived tokens for existing
dev users from `.env`, creates one temporary learner and deletes it afterwards.
Run it against `yarn dev` only: `next start` uses the **production** DB config.

## Sage AI tutor

1. Set `ANTHROPIC_API_KEY` in the server environment (e.g. `.env`, Vercel env).
2. Admin → **Mastery Ladder → Sage tutor**: enable/disable Sage, allow Socratic
   chat (off by default), choose the model (default `claude-opus-5-5`; Sonnet 5.5
   and Haiku 5.5 available), set the per-learner hourly limit.

Safety: the question context is rebuilt on the server from the signed start
token (browser-sent answers are ignored); replies are limited to ~3 sentences;
every reply — AI or built-in — passes an answer-leak check (number words,
fractions/decimals, choice letters/text, algebraically equivalent expressions)
and is replaced with safe help if it would reveal the answer. Each use is stored
as a hint on the attempt. If the API is unavailable, friendly built-in help is shown.

## Testing offline behaviour

1. Sign in, open **Mastery Ladder**, pick a learner, start a worksheet.
2. DevTools → Network → *Offline*. Keep answering; refresh — progress resumes.
3. Finish: results show as "saved on this device"; the study page shows N waiting.
4. Go back online: the queue syncs automatically (or within 60 s). Re-sending is
   safe — the server returns the stored attempt (`duplicate: true`).

The page itself must be loaded while online (there is no service worker);
starting a worksheet needs the server, finishing one does not.

## Known limitations / open product decisions

See `docs/mastery-ladder/IMPLEMENTATION_STATUS.md` → *Limitations*. In short: the
full Mastery Ladder specification was not in the repository, so set lists,
worksheets per set (5), questions per worksheet (8), target times and
`requireSpeedToAdvance` are documented assumptions in `lib/mastery/rules.js` /
`lib/mastery/curriculum.js`; Math K–O and two J sets have no generators yet and
are shown as unavailable rather than served with placeholder content.
