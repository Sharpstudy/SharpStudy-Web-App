# Performance audit and first optimization round

Measured on one laptop (4 cores / 8 threads, 7.9 GB RAM), production build (`next start`) against a throw-away TLS PostgreSQL 18 cluster holding a copy of the migrated data and test accounts. The load generator ran on the same machine, so every figure is a LOWER bound for the server. Tools: `tests/perf/*.mjs` (measure, qcount, assets, load, delay-proxy).

## Bottlenecks found (ranked)
1. **Sequential database round-trips on every authenticated request.** A student page costs 9 statements (admin 13), run one after another: `getAccountActor` (2), `/api/users/update` (7) behind a self-HTTP call from `_app.getInitialProps`. Database execution time is < 1 ms in total, but each statement is a network round-trip: with a 30 ms database round-trip a student page took 330 ms.
2. **Every route is server-rendered at runtime** (`_app.getInitialProps` disables static optimisation: all 249 routes are `λ`). One Node process saturates at about 50 requests/second on this laptop.
3. **Shared JavaScript** 387 kB first load (`_app` 196 kB) incl. `framer-motion` for a promo modal that is switched off; CSS 722 KB raw / 112 kB gzip from 18 global stylesheets.
4. **`public/` assets sent with `max-age=0`** (revalidated on every visit); feature illustrations 76-114 KB each.
5. **Admin dashboard** (`/api/funfacts`): seven sequential queries and every enrolment row loaded into memory to add up prices.
Not a bottleneck today: indexes (all 105 foreign keys already indexed), table sizes (whole database a few MB).

## Changes
| File | Change |
|---|---|
| `lib/mastery-server/http.js` | `getAccountActor`: user row and custom permissions fetched concurrently (used by every authenticated API) |
| `pages/api/users/update.js` | the independent look-ups run concurrently; results and rules unchanged |
| `pages/api/funfacts.js` | counts concurrent; earnings summed in SQL instead of loading all rows |
| `components/_App/Layout.js`, `SiteModal.js` | promo modal (and framer-motion) loaded only when switched on |
| `next.config.js` | cache headers for `/images`, `/video` (1 day + 7 days stale-while-revalidate) and `/fonts` (30 days) |
| `pages/index.js` | anonymous homepage `Cache-Control: public, s-maxage=60, stale-while-revalidate=300` (only when no login cookie; signed-in/invalid-cookie requests stay private/no-store) |
| `database/config/config.mjs` | `PG_POOL_MAX` (1-20, default stays 2) for long-running servers |

A first attempt to cache `/` and `/courses/` through `next.config.js` `missing:` cookie rules was found NOT to work on Next 12.3.4 (signed-in responses received the public header) and was removed before use.

## Before / after (p50, sequential requests, test accounts)
| Request | Before | After | Before (30 ms DB RTT) | After (30 ms DB RTT) |
|---|---|---|---|---|
| student /learning/my-courses/ | 24.3 ms | 23.7 ms | 332 ms | 176 ms (-47%) |
| student /family/ | 19.7 ms | 16.6 ms | 333 ms | 196 ms (-41%) |
| student /study/ | 24.7 ms | 15.3 ms | 327 ms | 195 ms (-40%) |
| GET /api/users/update | 11.1 ms | 7.4 ms | 308 ms | 169 ms (-45%) |
| instructor /instructor/courses/ | 17.3 ms | 14.6 ms | 188 ms | 117 ms (-38%) |
| admin /admin/ | 30.0 ms | 28.0 ms | 468 ms | 290 ms (-38%) |
| admin /admin/meetings/ | 17.0 ms | 14.5 ms | 155 ms | 114 ms (-26%) |
| homepage (anonymous) | 36.5 ms | 34.2 ms | 148 ms | 152 ms |
| login (bcrypt) | 10.1 ms | 11.8 ms | 80 ms | 79 ms |

First Load JS shared by all pages 387 kB -> 357 kB; `_app` 196 -> 166 kB; every page except the homepage lost about 30 kB. Statement counts per request are unchanged (same queries); only their serial depth fell (9 -> about 3).

## Load test (single Node process, this laptop, think time 1.5-4 s, shared sessions)
| Virtual users | req/s (base / optimized) | p95 (base / optimized) | errors | server RSS |
|---|---|---|---|---|
| 100 | 29.1 / 28.9 | 503 / 837 ms | 0% | 299 / 290 MB |
| 250 | 51.5 / 50.1 | 4,060 / 3,926 ms | 0% | 311 / 312 MB |
| 500 | 54.2 / 45.0 | 13,816 / 14,126 ms | 0% | 364 / 363 MB |
Under CPU saturation baseline and optimized are the same within noise: the changes remove round-trip latency, not CPU work. `PG_POOL_MAX=10` raised database connections from 5 to 21 and did not change throughput. **Demonstrated: about 100 concurrent users with p95 under 1 s on this hardware (one process). 1,000 / 2,500 / 5,000 virtual users were NOT run (see below).**

## Not verified / recommendations for 5,000 concurrent users
* 5,000 users is about 1,700 requests/second at these think times; at roughly 50 req/s per core-equivalent that needs on the order of 30 application cores, plus an external generator. Use a staging environment that mirrors production and distributed generators (k6 cloud/Grafana, or several load machines), against test accounts, never real payment services.
* Run several stateless instances behind a load balancer (or serverless), a CDN in front of `/_next/static`, `/images`, `/fonts` and the cacheable anonymous homepage, and size the PostgreSQL pool as instances x `PG_POOL_MAX` < `max_connections`; add PgBouncer only if instance count makes that impossible.
* Largest remaining engineering lever: stop disabling static optimisation (`_app.getInitialProps`): fetch the signed-in user on the client or in per-page `getServerSideProps`, so public pages can be statically generated.
* Not measured: file uploads, enrolment/payment writes, password reset, real network latency, a CDN, memory growth over hours.

## Security observations (nothing weakened)
* No raw SQL string interpolation found; login-cookie identity always re-checked from the database.
* `POST /api/users/signin` has no rate limit (sign-up, contact, coupons and books do): recommended, not changed here because it alters behaviour.
* `yarn audit` reports 369 advisories (15 critical, 146 high) in the dependency tree; not addressed in this round (needs a dependency-upgrade phase with regression testing).
