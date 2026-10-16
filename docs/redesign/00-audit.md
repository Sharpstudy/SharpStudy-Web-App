# SharpStudy UI Redesign — Phase 0 Audit

Date: 2026-10-09 · Scope: UI/UX + responsiveness only (no Mastery Ladder logic, no schema/API changes)

## 1. Stack (verified)

| Item | Finding |
|---|---|
| Framework | Next.js **12.3.4**, Pages Router (`pages/`), `trailingSlash: true` |
| React | 18.2.0 |
| Styling | Bootstrap 5 (vendored `styles/bootstrap.min.css`) + theme CSS (`style.css`, `responsive.css`, `dashboard.css`), Boxicons + Remixicon + Flaticon icon fonts. Font: Josefin Sans. |
| UI libs present | framer-motion 7, swiper 8, react-tabs, react-accessible-accordion, react-hot-toast, react-confirm-alert, react-loading-skeleton, Mantine 5 (RTE only) |
| State | Redux (cart) |
| Auth | JWT in `edmy_users_token` cookie; `_app.getInitialProps` resolves user via `/api/users/update`; route guard list in `_app.js`; admin pages also client-redirect in `AdminSideNav` |
| Data | Sequelize 6 + MySQL (local MySQL80 running), 17 migrations, 17 models |
| Payments / media | Stripe (`/api/checkout`), Cloudinary uploads, Jitsi (`react-jutsu`) live classes |
| Tests | None. No test script. |

**Important styling caveat:** `_app.js` imports the *compiled* `styles/*.css`, and `style.css` has drifted from `style.scss` (6,926 vs ~5,465 compiled lines). Recompiling the SCSS would silently drop edits. → The redesign adds a **new layer** (`styles/sharpstudy/*.scss`, imported last) and does not regenerate legacy CSS.

## 2. Baseline (before any change)

| Check | Result |
|---|---|
| `next build` | ✅ passes (lint skipped by config `ignoreDuringBuilds`) |
| `next lint` | ❌ **33 errors, 115 warnings** — pre-existing (lowercase page components calling hooks, unescaped `'`, `target=_blank` without `rel`) |
| Runtime | Dev server runs; all audited routes return 200 with real local data |
| Horizontal overflow | None detected at 360/390/768/1024/1440 on 18 audited routes (measured with headless Chrome, `scrollWidth` vs viewport) |
| Screenshots | Saved outside repo (scratchpad `baseline/`) |

Visual problems observed at baseline:
- Hero H1 animates per character and breaks **mid-word** ("transfor / mational").
- Home "Popular Courses" renders a bare word **"Empty"** (no course has `in_home_page = true`; data is correct, the empty state is not).
- Partner band renders as a large blank grey strip; several 100px+ empty vertical gaps.
- At 360px, logo collides with the cart icon in the header.
- Two unrelated palettes: blue public site (`#286bad`) vs teal dashboards (`#1cab94`); yellow Bootstrap `btn-warning` CTA.
- Admin mobile nav is a plain "Sidebar Menu" block; admin stat cards all use a cart icon.
- Footer links to `index.html` (dead) and social icons stacked vertically.
- `<Html lang="zxx">` (invalid language code), heavy hover-scale animations on every nav link.

## 3. Route inventory (49 pages)

**Public:** `/`, `/courses`, `/course/[slug]`, `/category/[slug]`, `/blog/blogs`, `/blog/[id]`, `/about-us`, `/contact-us`, `/faq`, `/privacy-policy`, `/terms-conditions`, `/become-an-instructor`, `/checkout`, `/swagger`
**Auth:** `/auth` (login + register tabs), `/confirm-email`. **Not present:** forgot-password and reset-password pages (`ForgotPasswordForm.js` exists but is unused; `/reset-password` is referenced in `_app.js` but has no page and no API). → Will *not* be invented; flagged.
**Student:** `/learning/my-courses`, `/learning/wishlist`, `/learning/my-purchase-history`, `/learning/course/[slug]` (player, quiz, assets, discussion), `/learning/course/class/[slug]` (Jitsi), `/learning/certificate/[slug]`, `/profile/basic-information`, `/profile/photo`. **Not present:** dashboard, notifications.
**Instructor:** `/instructor/courses`, `/instructor/course/create`, `/edit/[id]`, `/upload/[id]`, `/uploads/[id]`, `/assets/[id]`, `/create-quiz`, `/create-class`, `/instructor/quiz`. **Not present:** instructor dashboard / profile page.
**Admin:** `/admin`, `/admin/courses`, `/admin/courses/new-arrival`, `/admin/instructor`, `/admin/instructor/requests`, `/admin/students`, `/admin/students/site-admins`, `/admin/partners`(+create), `/admin/testimonials`(+create, `[id]`), `/admin/categories`(+create, `[id]`), `/admin/coupons`(+create), `/admin/coupons/modal-in-site-loading`. **Not present:** site-settings UI (settings live in `public/settings.json`).

Every page renders `<Navbar/>` and `<Footer/>` itself → redesigning those shared components propagates site-wide.

## 4. Mastery Ladder specification

**Not found in the repository** (searched for MASTER_PROMPT, *mastery*, *worksheet*, spec docs). Per instructions, no detailed Mastery Ladder requirements will be assumed. Only generic, reusable UI foundations (progress bar, stat tile, empty state, card, badge) will be built. **Action needed from you:** provide the spec before Phase 9.

## 5. Cuemath reference

Inspected via a text fetch of https://www.cuemath.com/en-in/ (markup → structure). **Limitation:** rendered visuals, colors and exact spacing could not be seen; only IA and component patterns were extracted:
- Grade/program mega-menu + Resources + About; two persistent CTAs (primary "Get Started", secondary).
- Hero with brand-led headline, short subhead, primary + secondary CTA.
- Trust bar with stat callouts + feature chips; testimonial cards; plus-icon FAQ accordion; secondary recruitment band (teach with us) with 3 benefit cards; multi-column footer with programs/resources/legal/social.

Applied to SharpStudy as *patterns only*, with SharpStudy's own content and data. No Cuemath assets, copy or code reused. Stats/ratings are **not** fabricated — only live counts from `/api/funfacts` may be shown.

## 6. Risks & security notes (pre-existing, not changed in UI phase)

1. **Stripe secret key hard-coded** in `next.config.js` `env` (committed). It is only referenced server-side, but it lives in source. Recommend moving to `.env` and rotating. *Not changed* (out of UI scope; changing could break checkout).
2. `/api/funfacts` (admin stats) and some admin data APIs are unauthenticated; admin page protection is cookie-presence + client redirect. Not changed — UI work will not weaken it.
3. Git root is the user home folder (`C:/Users/SURESH`), not this project. No git operations will be performed.
4. Many page components are lowercase (`const auth = () =>`), which breaks the rules-of-hooks lint and Fast Refresh. Renaming is safe and behaviour-neutral; done only on pages touched in the redesign.

## 7. Plan / sequence

| Phase | Work |
|---|---|
| 1 | Tokens (CSS vars) + `styles/sharpstudy/` layer: type scale, buttons, forms, cards, tables, badges, focus states; restyle legacy classes (`default-btn`, `form-control`, `single-courses`, tables…) so all 49 pages inherit; font → Plus Jakarta Sans; reusable components in `components/ui/` |
| 2 | Navbar (accessible mobile drawer, no layout collision), Footer, Homepage sections (hero, real courses/empty state, how it works, benefits, real testimonials/partners, FAQ, CTA) |
| 3 | `/auth` split layout, `PageBanner`, confirm-email states |
| 4 | Student: my-courses, wishlist, purchases, profile, course player shell |
| 5 | Instructor: courses grid, sub-navigation, forms |
| 6 | Admin: unified dashboard shell (sidebar → mobile drawer), stat tiles, tables |
| 7 | Viewport/a11y sweep at 360/390/768/1024/1440 |
| 8 | Lint/build regression vs baseline |
| 9 | Mastery Ladder readiness plan (needs spec) |
