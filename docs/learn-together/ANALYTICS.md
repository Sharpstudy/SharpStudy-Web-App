# Learn Together analytics

First-party only: `lt_analytics_events` (`name`, `family_key`, `device_class`, `props`, `at`). Nothing goes to Google Analytics.
`family_key` is an HMAC of the family id (`LT_SECRET`, falling back to `JWT_SECRET`), so distinct families can be counted without raw ids.
`props` are allow-listed in `learn-together/server/analytics.ts`. Nicknames, notes and raw answer values are dropped.

## Events

| Event | Where | Properties |
|---|---|---|
| `lt_onboarding_completed` | onboarding finish | childCount |
| `lt_child_profile_created` | add child | — |
| `lt_pairing_started` / `_approved` / `_denied` | pairing | childCount |
| `lt_device_revoked` | revoke | — |
| `lt_activity_previewed` | preview API | activityId, activityVersionId, subject |
| `lt_session_launched` | launch | activityId, activityVersionId, subject, mode, durationMode, childCount |
| `lt_launch_received` | child device | latencyMs (server launch time → lobby saw it, clock-offset corrected), transport |
| `lt_step_sync` | child device, 50% sampled | latencyMs (step change → child saw it), transport |
| `lt_child_ready` | child | — |
| `lt_child_help_raised` | child | — |
| `lt_child_response_submitted` | child | isCorrect only |
| `lt_misconception_observed` | parent "I saw this" | activityVersionId |
| `lt_session_resumed` | Home → Resume | groupId |
| `lt_session_completed` | end after reaching reflect | activityId, version, subject, mode, durationMode, lastStepIndex, sessionId |
| `lt_session_abandoned` | end before reflect / stale / replaced | same as above; `reason` = phase of last step |
| `lt_check_recorded` | parent | questionKey, interpretation |
| `lt_reflection_recorded` | parent | outcome |
| `lt_parent_confidence_rated` | parent | rating |
| `lt_concept_status_changed` | recompute | fromStatus, toStatus |
| `lt_concept_status_overridden` | parent override | toStatus |
| `lt_usefulness_rated` / `lt_confusion_reported` / `lt_safety_concern_reported` | preview page | activityId, rating |
| `lt_kit_interest_clicked` | preview page | kitKey, activityId |
| `lt_recommendation_followed` | Home "Start" | kind |
| `lt_realtime_reconnect` | either client | transport |
| `lt_launch_failed` | launch dialog | activityId |

## Dashboard metrics (`/learn/admin/metrics`, `learn-together/server/metrics.ts`)

Window = last N days (28/56/90). **Any cell backed by fewer than 5 distinct families is suppressed.**

| Metric | Formula |
|---|---|
| North star | per ISO week of `lt_session_groups.started_at`: distinct groups with ≥1 completed session ÷ distinct families that launched a group |
| Activation | families created in window that completed a session within 7 days of creation ÷ families created |
| Session completion | completed ÷ (completed + abandoned) `lt_sessions` started in window |
| Repeat use | families whose 2nd completed group is ≤14 days after their 1st (and 3rd ≤30 days) ÷ families with ≥1 completed group (all time) |
| Connected adoption | participants with a child device who joined ÷ all participants (groups in window) |
| Pairing success | pairing requests delivered ÷ created |
| Sync health | p50/p95 of `latencyMs` for `lt_launch_received` and `lt_step_sync`; counts of `lt_realtime_reconnect`, `lt_launch_failed` |
| Per activity | launches, completion rate, most common `max_step_index` among abandoned sessions, mean usefulness, confusion/safety counts, kit interest |
| Parent confidence | mean `lt_parent_confidence.rating` |
| Concept movement | counts of `lt_concept_status_changed` by from → to |
| Device mix | events by `device_class` (phone/tablet/desktop from user agent) |
