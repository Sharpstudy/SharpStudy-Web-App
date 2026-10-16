# Mastery Ladder — UI Readiness Plan (Phase 9)

> **Superseded:** the Mastery Ladder is now implemented — see
> `docs/mastery-ladder/IMPLEMENTATION_STATUS.md`. Kept for history.

> **Status: plan only — nothing here is implemented.** The detailed Mastery Ladder
> specification is **not in the repository**. This plan is limited to the feature
> list named in the redesign brief. Please share the spec (MASTER_PROMPT.md or
> equivalent) before the feature phase so requirements, data rules and edge cases
> come from it rather than from assumptions.

## 1. What already exists and can be reused

| Need (from brief) | Reusable now | Where |
|---|---|---|
| Consistent tokens (colour, type, spacing, radii, shadows, focus) | ✅ | `styles/sharpstudy/_tokens.scss` (`--ss-*` CSS variables; `--ss-accent` reserved for stars/streaks) |
| Dashboard shell with sidebar → mobile pill nav | ✅ | `components/Instructor/InstructorLayout.js`, `components/_App/AdminLayout.js`, `.ss-dash*` |
| Learner page shell with section tabs | ✅ | `components/Learning/StudentLayout.js` (add a `study` section) |
| Stat tiles (stars, streak, goals) | ✅ | `StatTile` in `components/ui` |
| Progress bars | ✅ | `ProgressBar` (accessible `role=progressbar`, success tone) |
| Cards / badges / empty states / page header / breadcrumbs | ✅ | `components/ui/index.js` |
| Accessible tabs, segmented control, action menu | ✅ | `.ss-tabs` + `role=tab`, `.ss-segmented`, `components/ui/ActionMenu.js` |
| Labelled form fields, password field | ✅ | `components/ui/Form.js` |
| Question-choice UI (lettered answer buttons, results grid) | ✅ pattern | `.ss-quiz__choices`, `.ss-quiz__results` in `CourseQuiz.js` |
| Lesson list with active state | ✅ pattern | `.ss-lesson` (`VideoList.js`) — basis for a worksheet list |
| Skeleton loaders | ✅ | `utils/CourseSkeletonLoader.js` pattern |

## 2. New UI components needed (by module)

| Module | New components | Notes / open questions for the spec |
|---|---|---|
| Learner profiles | `ProfilePicker` (avatar grid), `LearnerSwitcher` (header dropdown for parents) | How many learners per account? Auth model for child profiles? |
| Study dashboard | `TodayCard` (daily goal), `ContinueCard`, `StreakBadge`, `StarCounter` | Goal definition, streak reset rules, time zones |
| Subject → stage → level → set → worksheet → question | `LadderNav` (stepper/breadcrumb), `LevelMap`, `WorksheetCard` (status: locked / available / in progress / mastered) | Unlock/progression rules come from the spec's state machine |
| Worksheet player | `WorksheetPlayer` shell, `QuestionRenderer` per type, `AnswerPad` (numeric keypad for mobile), `PlayerProgress`, result screen | Question types, timing, retries, scoring |
| Progress & habits | `ProgressChart` (load the `dataviz` guidance first), `HabitGrid` (calendar heatmap) | Metrics and aggregation periods |
| Parent dashboard | `ParentLayout`, per-learner summary cards | Permissions between parent / learner / instructor |
| Instructor dashboard | extend `InstructorLayout` nav with classes/learners | Assignment of worksheets? |
| Printing | `PrintSettings` panel, `WorksheetPreview`, `@media print` stylesheet | Paper sizes, answer-key option |
| Sage AI tutor | `TutorPanel` (drawer on mobile, side panel on desktop), message list, composer | Model/provider, safety rules, cost limits, where data goes |
| Admin roles & settings | role/permission matrix table, settings forms on `AdminLayout` | Role list; must be enforced **server-side** (see §4) |

## 3. Suggested sequence (after spec approval)

1. Data model + API design reviewed against the spec (new Sequelize migrations).
2. Worksheet player (largest UX risk) behind a feature flag, tested on 360px first.
3. Ladder navigation + study dashboard.
4. Progress/habit visualisations.
5. Parent dashboard + learner switcher.
6. Printing.
7. Sage tutor.
8. Admin roles/permissions UI.

## 4. Pre-existing risks to address before building on top

- **Server-side authorisation:** admin pages are protected by cookie presence + a client-side redirect; some admin data APIs (e.g. `/api/funfacts`) are unauthenticated. New role-based features (parent, learner, admin) need API-level role checks.
- **Stripe secret key is hard-coded** in `next.config.js` — move to environment variables and rotate.
- **Student quiz tab shows a hard-coded sample quiz**, not the instructor-created quizzes (`/api/quizzes/student/quiz` is not used). Resolve before building worksheet scoring on the quiz pattern.
- Course progress is not returned by `/api/learnings`; the study dashboard will need a progress summary endpoint.
