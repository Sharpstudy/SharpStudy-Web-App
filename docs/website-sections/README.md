# Careers, Gallery, Blog and Success Stories

## Where each section's content lives

| Section | Route | Content source | How it is managed today |
| --- | --- | --- | --- |
| Success Stories | `/success-stories/` | Existing `testimonials` table via `GET /api/testimonials/` | Existing admin screens `/admin/testimonials` (create, edit, delete). Nothing new. |
| Blog | `/blog/blogs/`, `/blog/[id]` | `utils/sampleData.js` (`blogData`), unchanged | Edit that file. There is no blog table, API or admin screen. |
| Gallery | `/gallery/` | `lib/gallery/items.js` (ships empty) | Copy the photo to `public/gallery/` and add an entry. An entry is shown only with `consent: true`, a non-empty `alt`, a known category and a `/gallery/...` path. |
| Careers | `/careers/` | `lib/careers/jobs.js` (ships empty) | Add an entry to publish a vacancy. Teaching and telecaller interest uses the existing `/become-an-instructor/` and `/become-a-telecaller/` workflows; everything else uses `/contact-us/`. |

No database table, migration, API route or permission was added for these sections.

## Content SharpStudy still needs to provide

* **Gallery:** genuine photographs of workshops, classroom activities, events, competitions, student projects and learning activities, each with a written description (for `alt`) and **documented consent**. For any identifiable student, and always for a minor, that is the parent or guardian's written consent. Template images under `public/images` are not SharpStudy photographs and must not be used.
* **Careers:** confirmed vacancies (title, teaching or non-teaching, summary, responsibilities, required qualifications and experience, where to apply). Do not publish salary or benefits unless confirmed.
* **Success stories:** published testimonials (real people who agreed to be featured). There is no data source yet for student achievements, learning journeys, parent feedback, competition results or documented improvements. Adding them needs either more testimonial entries or the proposal below.
* **Blog:** the 8 existing articles are template placeholders (nature photography, cooking, travel; 2018 dates; images hosted by a third party). They were left untouched. Replace them with real SharpStudy articles. Articles have no author field; if you add `author: "Name"` to an article, it is shown automatically. Suggested categories: Personality Development, Mathematics, Leadership, Public Speaking, Learning and Education.

## Proposal (needs approval before any implementation): admin-managed content

If SharpStudy wants to manage these from the admin area instead of editing files:

1. **Job listings:** new `job_listings` table (title, type, summary, responsibilities, qualifications, experience, status, timestamps), admin-only create/update/delete APIs, a public read API of published rows. Optional: reuse the instructor-application style workflow for applications. Privacy: collect only name, email and a short message or CV link, store them with a retention period, and publish a privacy notice.
2. **Gallery:** new `gallery_items` table (image URL, alt text, category, consent flag, consent note, status) plus an upload path. The only upload mechanism today is the testimonial photo upload (Cloudinary); reuse it or add a storage bucket. Admin-only management; public API returns only items with `consent = true`.
3. **Blog:** `blog_posts` table (slug, title, body, category, author, published_at, image, status) and an admin editor; keep the existing `/blog/[id]` URLs working by migrating the 8 current ids.
4. **Success stories:** extend `testimonials` with optional `type` (testimonial, achievement, competition, parent feedback), `consent` and `published` fields.

All of these would be additive Sequelize migrations. Each needs a verified local database backup first, and none should run against production without explicit approval.


## Gallery page (`/gallery/`), updated

* **Data:** `lib/gallery/showcase.js` lists every card (title, description, category, alt text, real image path and size, optional route). Consented photographs added to `lib/gallery/items.js` appear automatically in the mosaic under Activities or Achievements.
* **Screenshots:** `public/images/gallery/platform/` and `public/images/gallery/programs/` (WebP, captured from the running site's public pages on 2026-11-23, no signed-in data). To refresh them, re-capture the page and keep the same filenames, then update the width/height in the data file (a test checks they match).
* **Not captured yet (need a sign-in with a demo account):** student dashboard, Mastery Ladder, Sage AI Tutor, course learning and quizzes, instructor dashboard, parent dashboard, admin dashboard, live classes. Capture them with a test account that has no real personal data, save as WebP in `public/images/gallery/platform/`, and add an entry (category `inside`, section `platform`).
* **Illustrations** (the eight topic tiles under Learning Experiences) are icon artwork, labelled "Illustration" on the page, and are not shown in the lightbox.
* **Video:** the featured video is the existing landing page video in `public/images/team/` (poster from `lib/site/heroMedia.js`); it loads only when Play is pressed.
