# Learn Together content guide

Activities are JSON files in `content/learn-together/<slug>.json`, validated by the Zod schema in
`learn-together/domain/schema.ts`. `yarn lt:seed` imports them into `lt_activity_versions` as **drafts**.
Nothing reaches parents until it passes review and is published in the admin (`/learn/admin`).

## Top-level fields

| Field | Notes |
|---|---|
| `slug`, `title` | Slug is the stable identity; don't change it after publishing. |
| `subject` | `math` or `science`. |
| `activityType` | MVP ships `real_life_math_mission`, `science_at_home_lab`. The schema also accepts the Phase 3 types (`data_detective`, `claim_or_evidence`, `logic_gym`, `learning_loop`, `mistake_museum`, `speaking_creativity`). |
| `ageBands` | Any of `6-7`, `7-8`, `8-9`. |
| `estimatedMinutes` | 5–20. |
| `learningGoal`, `realWorldHook`, `parentPreview` | Parent-facing prose. |
| `prerequisites`, `conceptTags` | Concept tags (snake_case). Labels and icons live in `content/learn-together/meta/concepts.json`. Use the same tags the planned daily-practice module will use. |
| `difficulty` | 1–3. Used by recommendations ("easier", "starter"). |
| `materials[]` | `item`, `householdSubstitution` (required), `smallParts` (adds a choking note). |
| `noPurchaseRoute` | **Required.** How to do it with nothing bought. |
| `scriptSteps[]` | See below. Must include at least one `check` and one `reflect` phase. |
| `expectedResponses[]` | Parent-only notes on what good answers sound like. |
| `misconceptions[]` | `key`, `signal`, `supportiveNextQuestion`, optional `suggestedActivitySlug`. |
| `checkQuestions[]` | **Exactly two**: one `near`, one `transfer`. |
| `extension`, `shorterVersion` | `shorterVersion.stepIds` picks the steps used in "Shorter version". |
| `accessibilityAdaptations[]` | At least one. |
| `safety` | **Required for science**: `hazards[]`, `supervision`, `stopConditions[]`, `cleanup`. |
| `optionalKit` | `kitKey`, `description`, `required: false` (any other value is rejected). |
| `filters` | `lowMess` (bool), `setting` (`indoor`/`outdoor`/`either`). |
| `pathway` | Optional `next`, `easier`, `extension` slugs for recommendations. |

## Script steps: two audiences

```json
{
  "id": "first_pick",
  "parent": { "phase": "do", "suggestedSeconds": 150, "parentSays": "...", "whyThisWorks": "...", "watchFor": ["counts_items"] },
  "child":  { "screen": "Apple + crackers + juice. How much?", "readAloudText": "...", "interaction": { "type": "number_entry", "expected": 9, "unit": "dollars" } }
}
```

- `parent.*` is **never** sent to a child device. `learn-together/domain/projection.ts` builds the child view from an allow-list, and the kid API refuses to respond if a parent-only key ever appears.
- `child.screen`: one short instruction (≤ 200 chars). `readAloudText` is spoken on-device by the browser.
- Child text must not copy parent text or contain phrases like "watch for", "misconception", "interpretation" or "Parent:". The validator rejects these.

### Interactions (child device)

| type | fields | checked how |
|---|---|---|
| `done_button` / `ready_button` | — | not scored |
| `choice` | `options[2–4]` {`key`,`label`}, optional `correctKey` | exact key |
| `number_entry` | optional `expected`, `tolerance`, `unit` | within tolerance |
| `ordering` | `items[2–6]`, optional `correctOrder` | exact order; shown shuffled |

Expected answers are stripped before reaching the child. Children never type free text.

### Check questions

`parentAsks` + `interpretation.{clear,partial,not_yet}` (parent-only guidance) + optional `child` screen/interaction shown on the child device during the `check` step.

## Authoring rules

- Fictional prices only; never ask about real household money.
- Science: paper, water, containers, household objects, plants or weather only. No heat, flames, ingestion, chemicals, tools, sharp objects or biological samples. The test suite scans for some banned words.
- Small parts (coins, beads, pasta): set `smallParts: true`, include the choking note in `safety.supervision`, and offer a larger alternative.
- Describe, don't grade. No scores or "wrong" language in child text.

## Review workflow

1. Editor saves a draft (admin JSON editor with live validation and parent/child previews, or `yarn lt:seed`).
2. Editor clicks **Request reviews**. Required reviews: `subject`, `developmental`, `accessibility`, `editorial`, plus `safety` for science.
3. Reviewers record **Approve** / **Request changes** with notes. A reviewer can't review a draft they created.
4. When every required review is approved, an editor publishes. Published versions are immutable; edits create a new draft version.
5. Admins can **roll back** to any previously published version (takes effect on the next launch) or **retire** an activity. Everything is in `lt_audit_log`.

Local dev only: `LT_DEV_PUBLISH_APPENDIX=true yarn lt:seed` publishes `snack-budget` and `paper-shape-coin-lab` without review so the flow can be tried. The script refuses to do this against a non-local database.
