# Schedule a call — meeting requests

Replaces the direct HubSpot link. Visitors send a request at `/schedule-a-call/`; an admin approves,
rejects or proposes another time at `/admin/meetings/`. **Nothing is confirmed until an admin approves it.**
There is no calendar integration (Google Calendar, HubSpot, …): availability is checked only against
meetings already approved inside SharpStudy. The existing Jitsi live-class feature is untouched; meeting
links are whatever URL the admin enters (or `MEETING_DEFAULT_URL`).

## Setup

```
yarn migrate      # creates meeting_requests, meeting_request_events and meeting_schedule_lock (all additive)
yarn check:email  # reports which e-mail settings exist (never their values); sends nothing
```

Environment variables (add to your real `.env` / hosting config; none are required for the form to work):

| Variable | Purpose |
|---|---|
| `MEETING_ADMIN_EMAIL` | Where "new meeting request" notices go. If unset the request is still saved and the admin e-mail is recorded as *skipped*. |
| `AWS_SES_USER`, `AWS_SES_PASSWORD` | Existing SMTP credentials (`email-templates/config.js`). Without them every e-mail is recorded as *skipped*. |
| `MEETING_LINK_SECRET` | Optional. Secret used to derive visitors' status-link tokens (falls back to `JWT_SECRET`). Changing it invalidates links already e-mailed. |
| `MEETING_DEFAULT_URL` | Optional default meeting link used when the admin leaves the link empty. |
| `MEETING_MAIL_FROM` | Optional From header (default `Sharpstudy Online Courses <hello@sharpstudy.io>`). |
| `BASE_URL` | Public site URL used in e-mail links (already used elsewhere). |

## Flow and rules

- Statuses: `pending`, `approved`, `rejected`, `reschedule_requested`, `cancelled`. Rejected and cancelled are final.
- Dates are entered in the visitor's time zone and stored both as entered and as a UTC instant (`requested_at`).
  Requests must be at least 1 hour and at most 180 days ahead. Meetings last 30 minutes.
- Admin decisions are compare-and-set on `(id, version, status)`: simultaneous clicks on the same request cannot both succeed (409).
- **Double booking is prevented by the database.** Approving (or a visitor accepting a proposed time) runs inside a MySQL transaction
  that first locks the single row of `meeting_schedule_lock` (`SELECT ... FOR UPDATE`). The overlap check (also a locking read) and the
  write happen while that lock is held and it is released at commit, so two approvals - from two admins, two tabs or two server instances -
  are serialised and the second one sees the first. Overlaps are refused with 409 `overlap`; adjacent meetings are fine. Deadlocks are retried.
  Proposals (`reschedule_requested`) do not reserve a slot; they are checked again when accepted.
- **Visitor status links.** The token in the link is `HMAC(server secret, request id)` (first 48 hex chars). Only its SHA-256 hash is stored,
  so a database leak reveals no working link, yet every e-mail (received, approved, rejected, rescheduled, cancelled, and Retry) can include the
  link because the server recomputes it. The page is `noindex`, sets a `no-referrer` referrer meta tag, and tokens are redacted from stored
  error text and logs. Requests created before this change (random tokens) keep working with the link they were given but later e-mails omit it.
  Rotating the secret breaks links already sent.
- E-mail failures never lose a request. Delivery state is stored per request (`admin_email_status`,
  `visitor_email_status`, `last_email_error`); the admin page shows failures with a **Retry sending** button.
- Rate limits: 30 requests/hour per client address (in-memory, per server instance), 3 requests/day per e-mail address
  (database), plus a hidden honeypot field and a per-request submission key against double submits.

## Checking e-mail safely

Nothing is sent unless you ask. Credentials come only from the server environment and are never returned, logged or stored
(errors from the mail server are scrubbed of the SMTP login before they are saved).

- `yarn check:email` - prints which settings are present (never values) and whether e-mail is ready.
- `yarn check:email -- --verify` - also connects and authenticates to SES SMTP, sending nothing.
- `yarn check:email -- --send-test` - sends ONE test message, only to `MEETING_ADMIN_EMAIL`.
- Admin page -> "E-mail setup" panel: the same checks behind buttons (the test send asks for confirmation; the recipient is always `MEETING_ADMIN_EMAIL`,
  never something typed into the request). `GET|POST /api/admin/meetings/email-check`, admin only, rate limited.

A message is only proven delivered when you actually receive it in the inbox; "accepted by the SMTP server" is not delivery.

## API

Public: `POST /api/meetings/request`, `GET|POST /api/meetings/manage` (needs reference + token).
Admin (token verified, role re-read from the database): `GET /api/admin/meetings`, `GET|POST /api/admin/meetings/<id>`
with `action` = `approve | reject | reschedule | cancel | note | resend_email`.

## Tests

`yarn test` (unit, `tests/meetings`: rules, concurrency incl. a control that double-books without the lock, status links, e-mail configuration),
`node tests/e2e/meetings.e2e.mjs` (API against the dev server + database, including 4 rounds of 6 simultaneous overlapping approvals),
`node tests/e2e/meetings-ui.e2e.mjs` (headless Chrome: form, double click, admin approval),
`node tests/e2e/meetings-responsive.e2e.mjs` (headless Chrome at 390, 440, 768, 1024 and 1366 px: form, validation messages, success screen,
status page, admin table and detail, with no sideways page scroll). The in-memory request limiter (30/hour per address) can return 429
after many runs; restart the dev server to reset it.
