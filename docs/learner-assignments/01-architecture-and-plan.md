# Learner profiles, instructor assignments and Family progress: architecture and plan

## The two identities (verified in the code and the dev database; they are NOT merged)

| | Account-backed student | Family / Learner profile |
| --- | --- | --- |
| Table | `users` (`role` student / instructor / admin) | `ml_learners` |
| Signs in with | e-mail + password (JWT cookie) | the owner account, then a 4-digit PIN (learner session token) |
| Relation to courses | paid `enrolments` (userId, courseId) | none |
| Mastery Ladder / worksheets | no | yes: subjects (`ml_subject_enrolments`), progress, attempts, stars, daily goal |
| Owner / access | the user themself | `owner_user_id` plus `ml_learner_guardians` (`parent` = manage, `instructor` = view + placement) |

Worksheets, grading, stars, daily goals and PIN sessions only exist for learner profiles. So **assignments target learner profiles** (stable `ml_learners.id`), never display names or e-mails. An account student is not silently turned into a learner; an instructor who wants to give worksheets to a course student creates (or is linked to) a profile for them.

## Instructor-to-learner relationship (already in the model, now used)
An instructor's students are the learners they **own** or are **linked to with relation `instructor`** (`ml_learner_guardians`). Admins (`learners.manage_all`) can oversee all. Instructors do not see other learners. Courses are not linked to learners; an assignment may record one of the instructor's own courses as context, and the "course" filter means "has an assignment in that course".

## Plan
1. Additive migration: `ml_learners.grade`, `birth_date`, guardian contact columns; `ml_assignments`, `ml_assignment_targets`.
2. Learner service: validate grade (LKG, UKG, Classes 1-7), date of birth or age; age is derived from the date of birth when present; date of birth and contact are only returned to adults with placement rights, never to learner sessions.
3. Assignments reuse the worksheet engine: an assignment names an existing (subject, level, set, worksheet). Starting it uses `startWorksheet` (token carries the assignment id); submitting uses `submitAttempt`. Completion is set only when `submitAttempt` has graded and stored the attempt; the score is read from that attempt, never copied.
4. One set of records feeds three views: instructor overview/detail, the learner's study home, and the existing Family dashboard (`learnerDashboard`).
5. Notifications reuse the existing `notifications` table (deduplicated, e-mail status recorded).
6. UI: extend the Family dashboard (learner form, filters, assignments), the study page and the worksheet page; add a pointer from `/instructor/students`.

---

# Update: Instructor Students directory and the account-student to learner bridge

## Gaps found
1. `/instructor/students` (and `/api/instructor/students`) listed one row **per enrolment**, so a student in three courses appeared three times; no search by name/e-mail, no grade or subject, no assignments.
2. There was **no relationship at all** between an account student (`users` + `enrolments`) and a learner profile (`ml_learners`): worksheets could not be assigned to a course student without an unrelated profile.
3. Learner profiles that an instructor owns or is linked to were not reachable from the Students page.

## Decisions
- The directory keeps one row per person: an enrolled **account student** (merged across courses) or a **profile-only** learner the instructor owns or is linked to. A row is never matched by name or e-mail.
- Bridge: nullable `ml_learners.student_user_id` (FK to users, unique). It is set only by an explicit, authorised action: an instructor who teaches a course the student has paid for either **creates a profile for that student** or **links an existing profile they manage**, after a confirmation. Nothing links automatically and no progress is copied or moved; linking an existing profile gives the student access to that profile's own progress.
- A linked student gets view-only access to their own profile (relation `self`): they unlock it with the PIN the instructor set and see their assignments on the study page. They cannot assign, edit the grade or see anyone else.
- The Students page is improved in place (same route and layout): summary cards, filters, pagination, details panel, assign flow. Assignment, grading, notifications and the Family dashboard keep using the same `ml_assignments` records.
