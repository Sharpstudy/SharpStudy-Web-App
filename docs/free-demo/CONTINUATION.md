# Free Demo Class: implementation and continuation report (updated 2026-11-23)

## How it works

A free demo request is a row in the existing `meeting_requests` table with `kind = 'free_demo'` (ordinary "Schedule a call" requests stay `kind = 'meeting'`). It is created by the existing `POST /api/meetings/request` (rate limit, honeypot, idempotency key, validation). No second table or API route exists.

* **Popup and buttons:** `components/FreeDemo/FreeDemoProvider.js` (one provider in `components/_App/Layout.js`, one dialog instance, the automatic popup, `BookFreeDemoButton`), `FreeDemoModal.js` (the form), `DemoBand.js` (page CTA band). Rules (where it shows, timing, sources, form validation) are in `lib/freeDemo/config.js`.
* **Backend:** `lib/meetings/service.js` (`validateDemoSubmission`, duplicate and rate rules, views, `demoStats`), `lib/meetings/repo.js`, `lib/meetings/emails.js`.
* **Admin:** `/admin/free-demo/` (sidebar: "Free Demo Requests") = the Meeting Requests page limited to demo requests (`RequestsAdmin` in `pages/admin/meetings/index.js`), plus filters (status, program, source), search (parent, child, phone, email, reference) and statistics.
* **Telecaller:** `/telecaller/` gains a "Free Demo Requests" tab (also `?kind=free_demo`); assignment, claiming, call notes, follow-up dates, status and history are the existing follow-up features (`lib/followups`).

## Database

Local PostgreSQL `sharpstudy_dev` (checked with `npm run db:check`). A verified JSON backup was taken first: `D:\SharpStudy-backups\db-pre-freedemo-20261123` (68 tables, 898 rows; every row count and SHA-256 verified) with `scripts/db/backup-json.mjs` (SELECT only; never overwrites an existing backup).

Migration `database/migrations-pg/20261123000006-pg-meeting-requests-free-demo.js` (additive, reversible) was applied **by name only** (`--name`). Matching MySQL file: `database/migrations/20261123000000-meeting-requests-free-demo.js` (not run). It adds `kind` (default `meeting`), `child_name`, `child_grade`, `program`, `source`, `source_page`, `class_mode`; drops NOT NULL on `email`, `requested_date`, `requested_time`, `requested_at`; adds CHECK constraints so a `meeting` row still requires all four and a `free_demo` row requires child name, grade and program; adds three indexes. `down()` refuses to run while any free-demo row exists.

**Left untouched on purpose:** migration `20261110000005-pg-add-auth-security-columns.js` is still *not applied* in `sharpstudy_dev`. Never run `migrate:pg` without `--name`.

## Status

| Requirement | Status |
|---|---|
| Automatic popup: first at 5 s, then 10 s after each close without a request, max 3 per visit, stops once a request is sent; one instance; excluded pages | Complete, browser tested (2026-11-23 update) |
| Booking form (required: parent, phone, child, grade, program; optional: email, date/time, class type, message) | Complete, browser tested |
| Backend validation + persistence + duplicate prevention + rate limit | Complete, tested against the real database |
| Admin "Free Demo Requests" (list, details, search, filters, status/reschedule, statistics) | Implemented and unit tested; **not opened in a browser (needs a login)** |
| Telecaller "Free Demo Requests" tab, details, assignment, notes, follow-ups | Implemented; list/filter tested against the real database; **not opened in a browser** |
| Shared CTA + placements | Complete, browser tested |
| Source tracking (source + page as columns) | Complete |
| Notifications | Admin e-mail needs `MEETING_ADMIN_EMAIL`; visitor receipt only when an e-mail was given. **No real e-mail was sent in testing.** |

## Remaining

1. Open `/admin/free-demo/` and the telecaller "Free Demo Requests" tab while signed in and check them (assignment, notes, statuses).
2. Decide whether to apply the pending auth migration in the dev database.
3. `next build` was not run (it would overwrite the folder the running dev server uses).


## Automatic popup timing (updated 2026-11-23)

* First popup 5 s after an eligible public page opens; each time it is closed without a request, the next one appears 10 s later; at most 3 automatic popups per visit (per browser tab session); a sent request stops all further automatic popups (this visit, and a week on this browser). "Book Free Demo" buttons always open the popup at once and never change the schedule or the count.
* The schedule is stored in sessionStorage (`ss_free_demo_next` = when the next one is due, `ss_free_demo_shown` = how many were shown); the single timer is only a wake-up derived from it, so page changes and reloads resume it (never restart the 5 s or reset the count). Rules: `lib/freeDemo/config.js` (`autoPlan`, `recordShown`, `recordClosed`, `postponeNext`); wiring: `components/FreeDemo/FreeDemoProvider.js`.
* Not shown while the tab is hidden (appears about 1 s after it becomes visible), while another dialog or the menu is open (retried, not counted), on login, checkout, careers, the meeting form, application pages or any dashboard, or to a signed-in account.
* The `NEXT_PUBLIC_FREE_DEMO_POPUP_DELAY_MS` setting and the 24-hour dismissal cooldown no longer exist.


## Popup redesign and international phone numbers (updated 2026-11-24)

* **Popup:** two-column dialog: child-friendly illustration (`public/images/freedemo/children-learning.svg`) with the heading "Big Dreams Start With Little Steps!" on the left, the enquiry form on the right (stacked, illustration on top, below about 700 px). Styles: `styles/sharpstudy/_freedemo.scss`. Components: `FreeDemoModal.js`, `PhoneField.js`. The timing rules above are unchanged.
* **Country selector:** `components/FreeDemo/PhoneField.js`: flag + dial code button (India +91 by default), searchable list (name, ISO code or dial code, with or without `+`), keyboard and screen-reader wiring. Flags are local files in `public/images/flags/` (no external requests).
* **Validation and storage:** `lib/freeDemo/phone.js` (libphonenumber-js). The form validates the national number for the chosen country and submits it as E.164 (`+919876543210`, fits the existing 40-character `phone` column). The server (`validateDemoSubmission` in `lib/meetings/service.js`) validates any number starting with `+` and stores it as E.164; a number without `+` (older clients) keeps the original rule (7+ digits), so nothing that worked before is rejected. Existing enquiry rows are never rewritten.
* **Duplicates and search:** `lib/freeDemo/phoneKey.js` (in-memory repositories) and `lib/freeDemo/phoneSql.js` (SQL, same on MySQL and PostgreSQL) compare numbers ignoring spaces, dashes, dots and brackets, and treat `98765 43210`, `+91 98765 43210`, `919876543210` and `+919876543210` as the same Indian number, so an older enquiry still matches a new one.
* **Admin and telecaller:** phone numbers stored as E.164 are shown as "+91 98765 43210" (`formatPhoneDisplay`); older values are shown exactly as stored.
* **Tests:** `tests/freeDemo/phone.test.mjs`, `tests/freeDemo/config.test.mjs` (timing rules), `tests/meetings/free-demo.test.mjs`, the phone case in `tests/db/pg-compat.test.mjs` (real PostgreSQL). Browser checks (popup timing, layout at 1440/1024/768/390/375 px, country selector) are driven by headless Chrome with the enquiry request intercepted, so no real enquiry or e-mail is created.

### First popup timing (verified 2026-11-24 against a production build)

The 5 s are counted from when the page opened, not from when the script finished hydrating. The very first plan of a visit uses `autoPlan(storage, now, sinceLoadMs)`: the wait is `5000 - sinceLoadMs`, never below `AUTO_POPUP.firstMinMs` (300 ms). `sinceLoadMs` is measured from navigation start for the first route and from the route change for later routes (a visitor who starts on the login page and then moves to a public page gets a full 5 s there). A stored schedule is never changed, so reloads and page changes still resume it. The dialog's code is fetched in idle time so it is ready when the timer fires. Measured on the production build (isolated copy, port 3100): the first popup is due exactly 5.00 s after navigation start on cold and warm loads (before: 5.3-5.9 s production, 5.1-7.3 s dev); repeats 10.0 s after each close; 3 per tab session; browser regression suite 32/32.
