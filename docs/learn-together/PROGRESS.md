# Learn Together: progress

Branch `feature/learn-together`. Nothing deployed and no production data touched. All migrations and tests ran against local MySQL scratch databases (`sharpstudy_lt_test`, `sharpstudy_lt_e2e`).

## Status by workstream

| WS | Status | Notes |
|---|---|---|
| WS1 Foundations | Done | Flag `FEATURE_LEARN_TOGETHER` (on in dev and preview, off in production unless set). Every `/learn` page and `/api/learn` route returns 404 when it's off (tested). One additive migration for all `lt_` tables, reversible (each test run does up → down → up). TS domain in `learn-together/domain`. |
| WS2 Parent login, family, children | Done | Uses the existing Sharp Study JWT. Onboarding, child CRUD (delete needs password re-auth), family PIN (change needs re-auth), device list and revoke, caregiver invites. Invite email is sent only when `LT_SEND_EMAIL=true`; otherwise the owner gets a link to share. |
| WS3 Child device login | Done | Pairing by code or QR with parent approval, httpOnly device cookie (hash stored), avatar and picture-code selection on shared devices, PIN-locked exit and unpair, 90-day idle expiry, audit log. |
| WS4 Realtime | Done (Ably path untested live) | `RealtimeTransport` with Ably and always-on polling fallback; seq-based resync. No `ABLY_API_KEY` was available, so all measured runs used **polling**. |
| WS5 Home and Explore | Done | Recommendations with reasons, device status, resume, filters, save and hide, `hasEntitlement` (free tier plus staff; no billing exists). |
| WS6 Connected player | Done | Launch to child devices, child lobby auto-open, parent controller (timer never auto-advances, why-this-works, watch-for with "I saw this", material alternatives, live child panel, help acknowledge), checks, reflection, single-device split view and PIN-locked child mode, sibling "Who's answering?", "Use this device for …" fallback. |
| WS7 Progress and metrics | Done | Concept rules and recommendation engine, unit-tested per branch. Progress page with date range, rhythm chart, concept map with check strip and override, answers, things noticed, time insights, confidence trend, CSV and JSON export. Child journey on the lobby. |
| WS8 Kits | Done | Parent-only "Tell me about this kit"; kit UI is never in child views; every kit activity has a no-purchase route (schema-enforced). |
| WS9 Content admin | Done | Lazy-loaded admin: list, JSON editor with live validation, parent and child previews, request and record reviews (no self-review), publish gating (safety required for science), version history, rollback, retire, tier, roles, parent reports. |
| WS10 Privacy | Done, with one open item | Export, delete child, delete family, re-auth, PRIVACY_NOTES.md. **Open:** the site Layout still loads GA and Jitsi on child pages (Layout change not approved). |
| WS11 Analytics | Done | `lt_analytics_event` table, all listed events, admin dashboard with <5-family suppression, ANALYTICS.md. |

## Gates (last run)

- `yarn lt:typecheck`: clean.
- `yarn lt:lint`: 0 errors (3 `no-img-element` warnings: data-URL QR and logo).
- `yarn lt:test`: **85 passed** (unit + DB integration).
- `yarn lt:e2e`: **7 passed** (two browser contexts, parent phone and child iPad), with axe checks on Onboarding, Home, Explore, Preview, Controller, Pairing, Join, Child lobby, Child follower, Progress and the three admin pages. Zero serious or critical violations inside Learn Together. The site Navbar, Footer and nprogress bar were excluded: they have pre-existing violations.
- `yarn build`: passes. The baseline had no tests; pre-existing lint errors elsewhere in the repo are unchanged.

## Measured sync latency (local `next dev`, polling transport, no Ably)

| Path | p50 | p95 | n |
|---|---|---|---|
| Parent taps Send → child lesson opens | ~1.7–1.9 s | — | 1 per run |
| Parent taps Next → child sees new step | ~0.82 s | ~1.33 s | 6 per run |

Launch includes up to 3 s lobby polling and a 0.9 s open animation (skipped with reduced motion). These are dev-server numbers with tiny samples. Real baselines come from `lt_launch_received` and `lt_step_sync` on the metrics page once a preview runs with Ably.

## Decisions (made without a check-in)

- Roles live in `lt_role_assignments`; `users.role` was not altered. Site admins implicitly have `lt_admin`.
- Parent API auth is the existing `Authorization` header only (no cookie fallback), which avoids CSRF on parent routes. Pages use the cookie only for the SSR gate.
- Pairing lockout is **per client** (5 wrong codes per 15 min per IP), not per request: a wrong code can't be tied to a request. Codes are single use, 10-minute, 31^6 space.
- Device online = seen in the last 45 s; heartbeat every 15–20 s; no long-held connections.
- Groups idle 6 h are auto-ended (abandoned). Launching a child into a new group ends their previous open group.
- A session counts as completed only if the group reached a `reflect` step before ending.
- Concept-day boundaries use UTC dates.
- Parent records (checks, notes, reflections) bump the group `seq` so every view refetches (bug found by e2e).
- Event timestamps that matter for ordering or latency use `DATETIME(3)`.
- No i18n layer existed, so a minimal catalog lives in `learn-together/client/i18n.ts`. Content carries `locale`.
- Avatars and picture codes are emoji, so no image assets or third-party requests.
- Pages pass child pre-selection through `sessionStorage`, never the URL.
- Admin pages are `next/dynamic` lazy-loaded; published content is cached 60 s per instance.
- PWA: `public/learn-manifest.webmanifest` (start `/learn/kid/`), `public/learn-sw.js` caches static assets only. These static files aren't flag-gated (they contain no data).
- `tsconfig.json` replaced `jsconfig.json` with the same aliases plus `@/learn-together/*`, `@/content/*`, `@/email-templates/*`.

## Deviations from the prompt

- **PRD missing** (D1): appendix activities and §16 items were written from the build prompt. PRD.md holds only "Changes in v1.1".
- **No nav entry** in the site Navbar/ProfileDropdown (not approved). Entry is via `/learn`; Learn Together has its own sub-navigation.
- **Layout not changed** (not approved). GA, Jitsi and the promo modal still load on child pages. Must fix before launch (PRIVACY_NOTES.md).
- Web push for "lesson launched" while the app is closed is **deferred**.
- "Lock a pairing request after 5 wrong codes" is implemented as a per-client lockout (above).

## Open items

1. Approve a small Layout.js change to drop GA, Jitsi and the modal on `/learn/kid*` and `/learn/join`.
2. Provision Ably (free) and set `ABLY_API_KEY` in **Preview** to exercise and measure the push path.
3. Human review of all 15 activities (all are drafts everywhere except local dev).
4. Pre-existing issues flagged in PLAN.md: Stripe secret key inlined via `next.config.js env`, SMTP credentials in source, non-httpOnly JWT, no sign-in rate limit, no password reset.
5. Legal review list in PRIVACY_NOTES.md.

## Environment variables

| Var | Where | Purpose |
|---|---|---|
| `FEATURE_LEARN_TOGETHER` | server | `true`/`false` override of the default flag |
| `ABLY_API_KEY` | server only | Enables realtime push; unset = polling |
| `LT_SECRET` | server only | Optional HMAC secret (falls back to `JWT_SECRET`) |
| `LT_DEVICE_IDLE_DAYS` | server | Device inactivity expiry (default 90) |
| `LT_SEND_EMAIL`, `LT_EMAIL_FROM` | server | Send caregiver invites by email |
| `LT_DEV_PUBLISH_APPENDIX` | seed script | Local-only publish of the two appendix activities |
