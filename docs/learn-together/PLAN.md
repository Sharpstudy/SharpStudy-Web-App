# Learn Together — Phase 0 Plan

Status: **awaiting approval**. No feature code has been written. Branch: `feature/learn-together`.

---

## 1. Stack findings (recon)

| Area | Finding |
|---|---|
| Framework | **Next.js 12.3, Pages Router** (`pages/`, `pages/api/*`), React 18. `output: "standalone"`, `trailingSlash: true`. |
| Language | **JavaScript only**. No `tsconfig`; `jsconfig.json` path aliases (`@/components/*`, `@/utils/*`, `@/database/*`, `@/store/*`). |
| Package manager | Yarn 1.22 (`yarn.lock`). Node 24 locally. |
| DB / ORM | MySQL via **Sequelize 6** + `sequelize-cli` migrations (`database/migrations`, `.sequelizerc`). Models are classes on a shared `connection` (`database/connection.js`). Production = Aiven over TLS, pool `max: 2`. Local dev = MySQL on 127.0.0.1 (`sharpstudy_dev`), all 17 migrations `up`. |
| Auth | Custom **JWT** (`jsonwebtoken`, 7-day expiry) signed in `pages/api/users/signin.js`, stored by `js-cookie` as `edmy_users_token` (**not httpOnly**), sent as the raw `Authorization` header. `_app.getInitialProps` re-fetches the user via `/api/users/update` on every page. Protected routes are a hard-coded list in `_app.js`. |
| Roles | `users.role` ENUM `student \| admin \| instructor`. |
| UI | Bootstrap 5 CSS + template SCSS (`styles/style.scss`; `$main-color #286bad`, `$optional-color #fec400`, Josefin Sans, 5px radius). Boxicons/Remixicon. `framer-motion`, `react-hot-toast`, `react-tabs`, Mantine (RTE only). Pages compose `<Navbar user/>` + content + `<Footer/>`; admin uses `AdminSideNav`. |
| State / data | Redux (cart), page-local `useState` + `axios` calls with `Authorization` header. |
| Email | `nodemailer` via AWS SES SMTP (`email-templates/config.js`). Usable for caregiver invites. |
| Payments | Stripe one-off checkout for course enrolments (`enrolments` table). No subscriptions/entitlements. |
| Analytics | Google Analytics `gtag` injected globally in `components/_App/Layout.js`. No first-party event store. |
| Realtime / push | None. (Jitsi external API script is loaded globally for live classes.) |
| i18n | None. |
| Tests | **None** (no Jest/Vitest/Playwright). |
| Lint | `next lint` (core-web-vitals). |
| CI | GitHub Action builds a Docker image to ECR (legacy); deploy is Vercel (`.vercel/project.json`). |

### Baseline health
- `yarn build`: **passes** (≈29 s).
- `yarn lint`: **fails with 33 pre-existing errors** (mostly `rules-of-hooks` in lowercase-named pages, unescaped entities). `next.config.js` already sets `ignoreDuringBuilds`. I will not fix these; the gate for new code is "zero lint errors in files under learn-together paths".
- Test suite: none exists → baseline is "build passes".

### Pre-existing issues to flag (not fixing — outside scope)
1. **`STRIPE_SECRET_KEY` is in `next.config.js` `env`**, which inlines it into client bundles (test key today, but a live key would leak).
2. SES SMTP credentials appear hard-coded in `email-templates/config.js`.
3. Session JWT lives in a non-httpOnly cookie; no rate limiting on sign-in; no password-reset endpoint (columns exist, flow doesn't).

These don't block Learn Together, but (3) means "parent login" inherits weaker session handling than the prompt assumes. Per WS2 I'm flagging it rather than replacing it.

---

## 2. Integration decisions

| Decision | Choice | Why |
|---|---|---|
| Parent account | Existing `users` row + existing JWT. Learn Together API verifies via existing `verifyUser()`-style helper. | Reuse auth. No change to user model. |
| Roles `lt_editor/lt_reviewer/lt_admin` | New table **`lt_role_assignment(userId, role)`**; existing `admin` implicitly has `lt_admin`. | Adding values to `users.role` ENUM = altering an existing column (stop condition #1). |
| Language | Add **TypeScript (`allowJs`)** scoped to new code. `tsconfig.json` replaces `jsconfig.json` with the same aliases plus `@/learn-together/*`. Existing JS untouched. | Prompt requires a framework-agnostic TS domain package reusable by Expo later. Next 12.3 supports incremental TS. *Needs your OK — see §11.* |
| Validation | **Zod** (new dep). | No existing validator beyond `validator`. |
| Code layout | `learn-together/` at repo root: `domain/` (pure TS: schema, projection, state machine, sync types, progress rules, recommendations), `server/` (models, auth, services, API wrappers), `client/` (components, hooks, transport), `content/` JSON lives in `content/learn-together/`. Pages are thin files under `pages/learn/**` and `pages/api/learn/**`. | Namespaced; mirrors `components/` + `pages/` conventions. |
| Styling | New `styles/learn-together.scss` reusing the existing SCSS variables (`$main-color`, `$optional-color`, font, radius) and Bootstrap grid/utilities. Child views get a larger, softer scale but the same palette/typeface. | Keep design integrity. |
| Global Layout | Small change to `components/_App/Layout.js`: **skip GA, Jitsi script and the site promo modal on `/learn/kid/*` and `/learn/join`**. | No third-party trackers or pop-ups on child devices. Only existing-file behaviour change besides nav. |
| Nav | One "Learn Together" item in `Navbar.js` + `ProfileDropdown.js`, rendered only when the flag is on (flag value passed via `pageProps` from `_app.getInitialProps`). | |
| Feature flag | `FEATURE_LEARN_TOGETHER` env, read server-side only. Default: on when `NODE_ENV !== 'production'` or `VERCEL_ENV === 'preview'`; off in production unless set to `true`. Every `/learn` page uses `getServerSideProps` → `notFound: true`; every `/api/learn` route goes through `withLearnTogether()` → 404. | |
| Entitlements | `hasEntitlement(user, feature)` → free tier only today (admins/`lt_*` roles get all). No checkout. | No subscription billing exists to wire to. |
| Caregiver invite | Build it (nodemailer exists): signed, single-use, 7-day invite token. | |
| i18n | Minimal message catalog `learn-together/client/i18n/en.ts` + `t()` helper. | None exists. |
| Analytics | `lt_analytics_event` table (first-party). GA is **not** used for any Learn Together event. | Keeps child data out of third parties. |

---

## 3. Auth design

### Parent principal (existing)
- `Authorization: <jwt>` header exactly as the rest of the app. Helper `requireParent(req)` → `{ userId, role }`, then `requireFamilyMember(userId)` resolves `familyId` server-side. **Every** query is scoped by `familyId` from the server, never from the request body.
- Sensitive actions (PIN reset, child deletion, export) require **re-auth**: POST password → short-lived (10 min) `lt_reauth` claim.

### Child-device principal (new, separate)
- Cookie `lt_device` = 32-byte random token; DB stores `sha256(token)` in `lt_child_device.deviceTokenHash`. Cookie: `httpOnly; Secure; SameSite=Strict; Path=/` (Path `/` needed so `/api/learn/kid/*` gets it).
- `requireChildDevice(req)` → loads device, rejects if revoked or `lastSeenAt` > 90 days (configurable `LT_DEVICE_IDLE_DAYS`), returns `{ deviceId, familyId, childProfileIds[] }`. Touches `lastSeenAt` at most once per minute.
- Child-device endpoints live only under `/api/learn/kid/*`. Parent endpoints reject requests that carry no parent JWT — the device cookie is never accepted there. Kid endpoints never accept the parent JWT (single-device mode uses parent endpoints with child projection).
- **CSRF:** SameSite=Strict + `Origin`/`Host` match check on every non-GET kid request.
- **Shared device + picture code:** active child selected by avatar tap; if a picture code is set, verify 3-icon sequence (hashed, rate-limited) → store `activeChildProfileId` in a second short-lived signed cookie. Responses are recorded against that child after the "Who's answering?" tap.
- **Leaving child mode** on a device requires the family PIN (bcrypt, 5 attempts → 15 min lockout).

### Pairing
1. Parent POST `/api/learn/pairing` → 6-char code from an unambiguous alphabet (no 0/O/1/I), stored as hash, 10-min expiry, plus QR encoding `https://<host>/learn/join?c=<code>`. *(The prompt's "no child data in URLs" is respected — the code isn't child data; it's single-use and expires.)*
2. Child device POST `/api/learn/kid/pairing/claim` with code + nothing else → status `claimed`, gets a short-lived **claim cookie** (random, hashed) to poll status.
3. Parent device sees the approval prompt (via realtime + polling) → Approve (with device label) / Deny.
4. On approve, the child device's next poll exchanges claim cookie → `lt_device` cookie. Single use; 5 wrong codes per pairing request → locked; IP-level rate limit on claim.
- Revoke → `revokedAt` set; next request 401; realtime: server publishes `device.revoked` and the token-auth endpoint refuses renewals (Ably tokens are issued with a 10-minute TTL, so worst case ≤10 min on the socket, but **all data access is via API and fails immediately**).

---

## 4. Realtime design (WS4) — recommendation

### Constraints
- Vercel functions: no shared in-memory pub/sub between instances; no Redis in the project.
- Aiven pool is `max: 2` per instance. Aiven `max_connections` depends on plan (Hobbyist ≈ 25–50, Startup-4 ≈ 75+). **I can't read the plan from here — please confirm.**
- SSE on Vercel would hold a function open per child device and, lacking a broker, would have to poll MySQL inside each stream → idle child devices would each hold a DB connection. **Rejected.**

### Options
| | (a) Ably free tier | (b) No new service: short polling |
|---|---|---|
| Latency | ~50–150 ms push | poll interval (1 s in session → p50 ≈ 0.5 s, p95 ≈ 1 s+) |
| DB load | Only on writes + reconnect resync | 1 indexed `SELECT seq` per device per second in session; 5–10 s in lobby |
| Idle devices | Hold a WebSocket to Ably, **zero** DB connections | Each poll borrows a pooled connection briefly |
| Channel auth | Server mints Ably tokens with per-channel capabilities (`lt:child:{id}`, `lt:group:{id}`) — maps exactly to the spec | Same scoping enforced in the poll endpoint |
| Cost / setup | Free: 6M msgs/mo, 200 concurrent conns. One server-only secret `ABLY_API_KEY`. | None |
| New dep | `ably` | none |

### Recommendation
**(a) Ably** behind a `RealtimeTransport` interface, with **(b) polling as the always-on fallback** (and the only transport if `ABLY_API_KEY` is unset — so dev/preview work with zero setup).

Protocol: server writes DB first (`seq = seq + 1` in a transaction) → publishes `{v:1, type, groupId, seq, payload}`. Clients keep `lastSeq`, ignore `seq <= lastSeq`, and on gap/reconnect call `GET /api/learn/(kid/)groups/:id/state?since=seq`. Payloads to child channels are already child-projected (no parent fields ever published on `lt:child:*`).

**What you'd provision:** an Ably account (free), create an API key with publish+subscribe, add `ABLY_API_KEY` to Vercel Preview env only. Pusher would also work (free 100 conns / 200k msgs/day) — Ably's capability-scoped tokens fit the per-channel authorization requirement more cleanly.

---

## 5. Data model (Sequelize)

All tables from BUILD_PROMPT §5, prefixed `lt_`, snake_case columns (`created_at/updated_at`) to match existing models; UUID primary keys (`DataTypes.UUIDV4`) like `users`. Arrays (`childProfileIds`, `conceptTags`, `subjectInterests`) → MySQL `JSON` columns, plus join table where we query by it (`lt_observation_concept` not needed — concept progress is its own table).

Additional tables beyond §5:
- `lt_role_assignment` (userId, role) — roles without altering `users.role`.
- `lt_caregiver_invite` (familyId, email, tokenHash, invitedByUserId, expiresAt, acceptedAt).
- `lt_pairing_claim` folded into `lt_pairing_request` (claimTokenHash, failedAttempts, lockedAt).
- `lt_analytics_event` (name, props JSON, familyIdHash, deviceClass, at) — no nicknames/free text.
- `lt_rate_limit` (key, windowStart, count) — DB-backed limiter (no Redis).

Foreign keys: `ON DELETE CASCADE` from `lt_child_profile` → sessions, responses, observations, progress, device links; from `lt_family` → everything. FK to `users.id` uses `ON DELETE CASCADE` on `lt_family_member` only (no change to `users`).

Migrations: one file per workstream group (`2026101300000x-lt-*.js`), each with a full `down`. Verified `up → down:all-lt → up` on a fresh scratch DB (`sharpstudy_lt_test`), never production.

---

## 6. Route map

**Parent (`/learn`, JWT)**
`/learn` Home · `/learn/onboarding` · `/learn/explore` · `/learn/activity/[slug]` preview + launch · `/learn/session/[groupId]` controller · `/learn/progress/[childId]` · `/learn/family` (children, PIN, devices, caregivers) · `/learn/family/pair` · `/learn/privacy` · `/learn/invite/[token]`
**Admin (`/learn/admin`, `lt_*` roles)**: `/learn/admin/activities`, `/learn/admin/activities/[id]` (editor + previews + reviews + history), `/learn/admin/metrics`
**Child device (`/learn/kid`, device cookie)**: `/learn/join` · `/learn/kid` lobby (+ avatar picker / picture code) · `/learn/kid/session/[groupId]` follower · `/learn/kid/exit` (PIN)
**Single-device child mode**: `/learn/session/[groupId]?view=child` is avoided (no child data in URLs is fine, but view state lives in component state + PIN to exit).
**API**: `/api/learn/**` (parent), `/api/learn/kid/**` (device), `/api/learn/admin/**`, `/api/learn/realtime/token` (both principals, capability-scoped).
**PWA**: `public/learn-manifest.webmanifest` (`start_url: /learn/kid`), minimal service worker scoped to `/learn/` caching static assets only (no child data cached).

---

## 7. Component tree (abridged)

```
learn-together/client/
  layout/   LearnShell (Navbar+Footer, parent)  KidShell (no nav/footer, large type, PIN exit)
  parent/   HomeHero, ChildCard(+DeviceStatus), RecommendationCard, ExploreFilters, ActivityCard,
            ActivityPreview, LaunchDialog(who's learning / send vs this device),
            Controller{StepScript, StepTimer, WhyThisWorks, WatchFor, MaterialAlts, ChildLivePanel, CheckRecorder, ReflectForm},
            Progress{ThisWeek, WeeklyRhythmChart, ConceptMap, CheckStrip, ChildAnswers, Misconceptions, TimeInsights, ConfidenceTrend, Export},
            Family{ChildForm, PinForm, DeviceList, PairDevice(QR+code+approve), CaregiverInvite}
  kid/      Lobby, JourneyMap, AvatarPicker, PictureCode, FollowerStep, Interaction{Done,Ready,Choice,Number,Ordering},
            HelpButton, WhoIsAnswering, ClosingCelebration, ReadAloud
  admin/    ActivityList, JsonEditor(+live Zod errors), ParentPreview, ChildPreview, ReviewPanel, VersionHistory, MetricsDashboard
  realtime/ RealtimeTransport, AblyTransport, PollingTransport, useGroupState(seq), usePresence
```

---

## 8. Workstream order

WS1 → WS11 exactly as in BUILD_PROMPT §10, one or more commits each, `PROGRESS.md` updated after each.

## 9. Testing plan

- Add **Vitest** (unit + integration against a scratch MySQL DB `sharpstudy_lt_test`, migrations run in global setup) and **Playwright** (+ `@axe-core/playwright`) for two-context e2e and accessibility. No existing tools to reuse.
- Gate per workstream: `tsc --noEmit` (learn-together), `next lint --dir learn-together --dir pages/learn --dir pages/api/learn` clean, Vitest green, migrations reversible, `yarn build` passes.

## 10. Risks

| Risk | Mitigation |
|---|---|
| Next 12 + TS 5 / modern deps (Zod 3, Ably 2, Vitest) compatibility | Pin versions known to work with Next 12/webpack 5; verify `yarn build` per WS. |
| Existing auth weaknesses (non-httpOnly JWT, no rate limit) | Learn Together endpoints add their own rate limiting; flagged above. |
| `_app.getInitialProps` makes every page SSR and calls `/api/users/update` | Kid pages do no user lookup (no JWT); harmless. |
| Aiven connection ceiling | Ably for push; polling endpoints are single indexed reads; pool stays `max: 2`. |
| Scope: 11 workstreams | Executed sequentially with gates; deferrals recorded in PROGRESS.md. |
| **PRD not in repo** | See decision D1. |

## 11. Decisions needed from you

- **D1 — PRD.** `docs/learn-together/PRD.md` isn't in the repo or Downloads. It's referenced for product behaviour, the two appendix activities (Snack Budget, Paper Shape coin lab), §6 content fields and the §16 launch gate. Please add it. Without it I'll author those from the build prompt alone and mark every PRD-dependent item "needs human".
- **D2 — Realtime.** Approve Ably (free tier, `ABLY_API_KEY` in Preview env), or polling-only.
- **D3 — TypeScript.** Approve adding `typescript` + `tsconfig.json` (allowJs, replaces `jsconfig.json` with identical aliases) for new code.
- **D4 — New dev/runtime deps.** `zod`, `qrcode`, `ably` (if D2), `typescript`, `vitest`, `@playwright/test`, `@axe-core/playwright`.
- **D5 — Layout change.** OK to suppress GA/Jitsi/promo modal on child-device routes (`/learn/kid/*`, `/learn/join`)?
- **D6 — Aiven plan.** Which plan (for `max_connections`)? Not blocking.
