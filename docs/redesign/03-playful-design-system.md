# SharpStudy playful design system (books-first redesign)

One token set, two moods. `components/_App/Layout.js` wraps every page in `ss-mode--play` or `ss-mode--pro`
(`components/_App/designMode.js`). Nothing else decides the look of a page.

| Mode | Routes | Look |
|---|---|---|
| play | public site, `/books`, `/courses`, `/blog`, `/about-us`, `/contact-us`, `/auth`, `/learning`, `/study`, `/family`, `/print`, `/profile`, `/checkout` | pastel surfaces, pill buttons, Fredoka headings, soft shadows, illustrations |
| pro | `/admin/*`, `/instructor/*` | same palette and components, tighter corners, Plus Jakarta headings, plain backgrounds |

## Tokens (`styles/sharpstudy/_tokens.scss`)
Pastel surfaces `--ss-peach #fff0e8`, `--ss-sky #ddf3ff`, `--ss-sun #fff1a8`, `--ss-mint #ddf7e5`, `--ss-lav #eee5ff`, ink `#25304a`.
Each pastel has a `-strong` tone (icons, borders) and a dark `-ink` tone for text on it (all >= 7:1, asserted in `tests/books/redesign.test.mjs`).
Radii 10/14/20/28, soft ink-tinted shadows, `--ss-font-display` (Fredoka) for headings in play mode.

## Layers
- `_play.scss` (loaded last): re-skins header, buttons, cards, page headers, footer, forms, auth, empty states, and defines age cards,
  subject tiles, filter chips, Continue Reading, blog/contact/error helpers, and the pro overrides.
- `components/ui/Illustration.js`: original SVG scenes (hero, auth, empty/error). `components/ui/ConfirmDialog.js`: accessible dialog.

## Page inventory (existing route -> treatment)
Public: `/` (book-first hero, Explore by Age, Featured/New/Popular shelves, subject tiles, Books-vs-Courses band, then the existing courses,
how-it-works, benefits, testimonials, partners, audiences, FAQ, CTA), `/books`, `/books/[slug]`, `/books/[slug]/checkout`, `/courses`,
`/course/[slug]`, `/category/[slug]`, `/about-us`, `/blog/blogs`, `/blog/[id]`, `/contact-us`, `/faq`, `/privacy-policy`, `/terms-conditions`,
`/auth`, `/confirm-email`, `/become-an-instructor`, `/schedule-a-call(/status)`, new `/404`, `/500`.
Student: `/learning/*` (My Courses gets Continue Reading), `/learning/my-books(/read/[slug])`, `/study*`, `/family`, `/print`, `/profile/*`, `/checkout`.
Instructor (pro): `/instructor/*`. Admin (pro): `/admin/*` including `/admin/books` and `/admin/books/[id]`.

## Known gaps
- There is no forgot-password or reset-password page in the app (`ForgotPasswordForm` exists but is not routed); none was invented.
- The blog has no backend: articles are static sample data in `utils/sampleData.js` (dated 2018, hot-linked images). They were restyled, not replaced.
- Pages were re-skinned through shared components and tokens; they have not all been reviewed visually in a browser.
