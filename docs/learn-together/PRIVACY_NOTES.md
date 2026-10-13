# Learn Together privacy notes

## Data inventory

| Table / field | Purpose | Retention |
|---|---|---|
| `lt_families` name, PIN hash (bcrypt) | Group parents and children; PIN unlocks child mode | Until the family deletes it |
| `lt_family_members` userId, role | Who can act for the family | Until removed / family deleted |
| `lt_caregiver_invites` email, token hash | Invite a second grown-up | 7-day expiry; deleted with the family |
| `lt_child_profiles` nickname, avatar, age band, language, accessibility prefs, interests, picture-code hash | Personalise activities | Until the child is deleted. **No** full name, birth date, email, phone, photo or location fields exist. |
| `lt_child_devices` parent-set label, token **hash**, paired/last-seen/revoked times | Child sign-in | Revoked on request, on child deletion, or after 90 days idle (`LT_DEVICE_IDLE_DAYS`) |
| `lt_pairing_requests` code hash, claim-token hash, child ids | Pairing | 10-minute codes; rows deleted with the family |
| `lt_sessions`, `lt_step_events`, `lt_session_participants` | What was done, when, for how long | Until the child/family is deleted |
| `lt_child_responses` structured values only (choice key, number, order, done) | Show the parent what the child tried | Same |
| `lt_help_signals`, `lt_misconceptions_seen`, `lt_session_checks` | Live help; parent observations | Same |
| `lt_observations` outcome, private parent note | Parent reflection | Editable/removable; deleted with the child |
| `lt_concept_progress` | Derived status | Recomputed; deleted with the child |
| `lt_parent_confidence`, `lt_feedback`, `lt_kit_interest` | Parent's own ratings and reports | Deleted with the family (feedback/kit rows for all family members) |
| `lt_audit_log` | Accountability: ids and actions only, never nicknames, notes or answers | Not deleted with the family (ids become dangling). **Legal review:** retention period. |
| `lt_analytics_events` | Product metrics, pseudonymous HMAC family key, allow-listed properties only | Deleted with the family |

## Child-device credential

- 32 random bytes, delivered once as `lt_device`: `HttpOnly; SameSite=Strict; Secure` (in production), `Path=/`. Only its SHA-256 hash is stored.
- Delivery happens only after the parent approves on their own signed-in device. A claim cookie (also hashed server-side) links the waiting device to the request.
- Codes: 6 characters from a 31-symbol alphabet, single use, 10-minute expiry. Wrong-code attempts are limited to 5 per client per 15 minutes and 30 claims per 10 minutes. A wrong code can't be tied to a specific request, so lockout is per client rather than per request (deviation from the prompt; see PROGRESS.md).
- Child-device requests also pass an Origin/Sec-Fetch-Site same-origin check (CSRF).
- Revocation takes effect on the next request (hash cleared). With Ably enabled, a live socket can keep receiving child-safe events until its 10-minute token expires, but it can read nothing through the API.
- The device principal is accepted only on `/api/learn/kid/*`. Parent routes require the existing Sharp Study JWT.

## Deletion behaviour

- **Delete a child** (needs password re-auth): FK cascades remove sessions, responses, checks, signals, observations, progress, saved/dismissed rows and device links. Devices left with no children are revoked.
- **Delete all family data** (owner, needs re-auth): removes the family and everything under it, plus feedback/kit-interest rows of all family members and analytics events with that family's key. The Sharp Study account itself is untouched.
- Sharp Study has no account-deletion flow yet, so there is nothing to hook into. When one is added, it should call `deleteFamilyData` for owners and remove `lt_family_members` rows (FK cascade already does this for caregivers).

## Things that never happen

- No free text, audio, camera or AI on child devices. No ads. No child data in URLs or query strings (ids are opaque UUIDs; the pairing code is removed from history on the join page).
- Learn Together sends **no** analytics to Google Analytics.
- **Open item:** the existing site Layout loads Google Analytics, the Jitsi script and an optional promo modal on every page, including child-device pages. Removing them on `/learn/kid` and `/learn/join` needs a small change to `components/_App/Layout.js`, which was not approved for this build. **This must be resolved before public launch.**

## For legal review before public launch

1. Child privacy law in launch markets (COPPA in the US, UK Age Appropriate Design Code, GDPR-K, PIPEDA and provincial law in Canada): verifiable parental consent for child-device access, notice wording, retention periods, and the audit log.
2. Parental consent flow: currently pairing approval plus the onboarding explainer. Confirm this is sufficient as consent.
3. Third-party scripts on child pages (GA, Jitsi), above.
4. Ably, if enabled, as a processor: data processing agreement and region. Payloads carry only ids, seq and step numbers.
5. Consumer protection: the "Included in full pathways" state and kit interest capture.
6. Accessibility conformance statement (WCAG 2.2 AA target).
7. Physical product rules for future kits (toy safety, small-parts labelling).
