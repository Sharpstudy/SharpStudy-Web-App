// Learn Together activity content schema. Framework-agnostic: no Next/React/Sequelize imports.
import { z } from "zod";

export const SUBJECTS = ["math", "science"] as const;
export const AGE_BANDS = ["6-7", "7-8", "8-9"] as const;
export const PHASES = ["connect", "do", "explain", "check", "reflect"] as const;

// Only the first two ship in the MVP; later types are accepted by the schema so
// Phase 3 content can be authored without a schema migration.
export const MVP_ACTIVITY_TYPES = ["real_life_math_mission", "science_at_home_lab"] as const;
export const ACTIVITY_TYPES = [
  ...MVP_ACTIVITY_TYPES,
  "data_detective",
  "claim_or_evidence",
  "logic_gym",
  "learning_loop",
  "mistake_museum",
  "speaking_creativity",
] as const;

export type Subject = (typeof SUBJECTS)[number];
export type AgeBand = (typeof AGE_BANDS)[number];
export type Phase = (typeof PHASES)[number];
export type ActivityType = (typeof ACTIVITY_TYPES)[number];

const key = z.string().regex(/^[a-z0-9][a-z0-9_-]*$/, "use lowercase letters, digits, - or _");
const text = z.string().trim().min(1);

export const choiceOptionSchema = z.object({ key, label: text, imageKey: key.optional() });

export const interactionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("done_button") }),
  z.object({ type: z.literal("ready_button") }),
  z.object({
    type: z.literal("choice"),
    options: z.array(choiceOptionSchema).min(2).max(4),
    correctKey: key.optional(),
  }),
  z.object({
    type: z.literal("number_entry"),
    expected: z.number().optional(),
    tolerance: z.number().min(0).optional(),
    unit: z.string().max(20).optional(),
  }),
  z.object({
    type: z.literal("ordering"),
    items: z.array(z.object({ key, label: text })).min(2).max(6),
    correctOrder: z.array(key).optional(),
  }),
]);
export type Interaction = z.infer<typeof interactionSchema>;

export const childScreenSchema = z.object({
  screen: text.max(200),
  imageKey: key.optional(),
  readAloudText: z.string().max(400).optional(),
  interaction: interactionSchema.optional(),
});
export type ChildScreen = z.infer<typeof childScreenSchema>;

export const scriptStepSchema = z.object({
  id: key,
  parent: z.object({
    phase: z.enum(PHASES),
    suggestedSeconds: z.number().int().min(10).max(900),
    parentSays: text,
    whyThisWorks: z.string().optional(),
    watchFor: z.array(key).optional(),
  }),
  child: childScreenSchema,
});
export type ScriptStep = z.infer<typeof scriptStepSchema>;

export const checkQuestionSchema = z.object({
  key: z.enum(["near", "transfer"]),
  parentAsks: text,
  interpretation: z.object({ clear: text, partial: text, not_yet: text }),
  child: childScreenSchema.optional(),
});
export type CheckQuestion = z.infer<typeof checkQuestionSchema>;

export const misconceptionSchema = z.object({
  key,
  signal: text,
  supportiveNextQuestion: text,
  suggestedActivitySlug: key.optional(),
});

export const safetySchema = z.object({
  hazards: z.array(text).min(1),
  supervision: text,
  stopConditions: z.array(text).min(1),
  cleanup: text,
});

export const materialSchema = z.object({
  item: text,
  householdSubstitution: text,
  smallParts: z.boolean().optional(),
});

export const activityContentSchema = z
  .object({
    slug: key,
    title: text.max(80),
    subject: z.enum(SUBJECTS),
    activityType: z.enum(ACTIVITY_TYPES),
    ageBands: z.array(z.enum(AGE_BANDS)).min(1),
    estimatedMinutes: z.number().int().min(5).max(20),
    learningGoal: text,
    prerequisites: z.array(key),
    difficulty: z.number().int().min(1).max(3),
    conceptTags: z.array(key).min(1),
    realWorldHook: text,
    materials: z.array(materialSchema),
    noPurchaseRoute: text,
    parentPreview: text,
    scriptSteps: z.array(scriptStepSchema).min(3),
    expectedResponses: z.array(text).min(1),
    misconceptions: z.array(misconceptionSchema),
    checkQuestions: z.array(checkQuestionSchema),
    extension: text,
    shorterVersion: z.object({ description: text, stepIds: z.array(key).min(2) }),
    accessibilityAdaptations: z.array(text).min(1),
    safety: safetySchema.optional(),
    optionalKit: z
      .object({ kitKey: key, description: text, required: z.literal(false) })
      .optional(),
    filters: z.object({
      lowMess: z.boolean(),
      setting: z.enum(["indoor", "outdoor", "either"]),
    }),
    pathway: z
      .object({ next: key.optional(), easier: key.optional(), extension: key.optional() })
      .default({}),
  })
  .superRefine((a, ctx) => {
    const issue = (message: string, path: (string | number)[] = []) =>
      ctx.addIssue({ code: z.ZodIssueCode.custom, message, path });

    if (a.subject === "science" && !a.safety) issue("science activities require a safety block", ["safety"]);

    const phases = new Set(a.scriptSteps.map((s) => s.parent.phase));
    if (!phases.has("check")) issue("script needs at least one 'check' phase step", ["scriptSteps"]);
    if (!phases.has("reflect")) issue("script needs at least one 'reflect' phase step", ["scriptSteps"]);

    if (a.checkQuestions.length !== 2) issue("exactly two check questions are required", ["checkQuestions"]);
    const checkKeys = a.checkQuestions.map((c) => c.key).sort().join(",");
    if (a.checkQuestions.length === 2 && checkKeys !== "near,transfer")
      issue("check questions must be one 'near' and one 'transfer'", ["checkQuestions"]);

    const stepIds = new Set<string>();
    a.scriptSteps.forEach((s, i) => {
      if (stepIds.has(s.id)) issue(`duplicate step id '${s.id}'`, ["scriptSteps", i, "id"]);
      stepIds.add(s.id);
    });
    a.shorterVersion.stepIds.forEach((id, i) => {
      if (!stepIds.has(id)) issue(`unknown step id '${id}'`, ["shorterVersion", "stepIds", i]);
    });

    const misKeys = new Set(a.misconceptions.map((m) => m.key));
    a.scriptSteps.forEach((s, i) =>
      (s.parent.watchFor || []).forEach((k) => {
        if (!misKeys.has(k)) issue(`watchFor references unknown misconception '${k}'`, ["scriptSteps", i, "parent", "watchFor"]);
      })
    );

    const checkInteraction = (inter: Interaction | undefined, path: (string | number)[]) => {
      if (!inter) return;
      if (inter.type === "choice" && inter.correctKey && !inter.options.some((o) => o.key === inter.correctKey))
        issue("correctKey must match an option key", [...path, "correctKey"]);
      if (inter.type === "ordering" && inter.correctOrder) {
        const items = inter.items.map((i) => i.key).sort().join(",");
        if ([...inter.correctOrder].sort().join(",") !== items)
          issue("correctOrder must be a permutation of item keys", [...path, "correctOrder"]);
      }
    };
    a.scriptSteps.forEach((s, i) => checkInteraction(s.child.interaction, ["scriptSteps", i, "child", "interaction"]));
    a.checkQuestions.forEach((c, i) => checkInteraction(c.child?.interaction, ["checkQuestions", i, "child", "interaction"]));

    // Child-facing text must not leak parent-only content.
    const parentOnly: string[] = [];
    a.scriptSteps.forEach((s) => {
      parentOnly.push(s.parent.parentSays);
      if (s.parent.whyThisWorks) parentOnly.push(s.parent.whyThisWorks);
    });
    a.misconceptions.forEach((m) => parentOnly.push(m.signal, m.supportiveNextQuestion));
    a.checkQuestions.forEach((c) => parentOnly.push(c.interpretation.clear, c.interpretation.partial, c.interpretation.not_yet));
    const leaks = (childText: string) => findParentOnlyReference(childText, parentOnly);
    const checkChild = (c: ChildScreen | undefined, path: (string | number)[]) => {
      if (!c) return;
      for (const [field, value] of [["screen", c.screen], ["readAloudText", c.readAloudText]] as const) {
        if (value && leaks(value)) issue(`child-facing ${field} references parent-only content: ${leaks(value)}`, [...path, field]);
      }
    };
    a.scriptSteps.forEach((s, i) => checkChild(s.child, ["scriptSteps", i, "child"]));
    a.checkQuestions.forEach((c, i) => checkChild(c.child, ["checkQuestions", i, "child"]));
  });

export type ActivityContent = z.infer<typeof activityContentSchema>;

const PARENT_MARKERS = [/\bparentSays\b/i, /\bwhy this works\b/i, /\bwatch for\b/i, /\[parent\]/i, /\{\{/, /^\s*(parent|grown-up note)\s*:/i, /\bmisconception\b/i, /\binterpretation\b/i];

/** Returns a short description of the leak, or null. Exported for tests. */
export function findParentOnlyReference(childText: string, parentOnlyTexts: string[]): string | null {
  for (const re of PARENT_MARKERS) if (re.test(childText)) return `marker ${re}`;
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
  const c = norm(childText);
  for (const p of parentOnlyTexts) {
    const n = norm(p);
    // Any 40-char window of parent-only text appearing verbatim in a child field is a leak.
    if (n.length >= 40) {
      for (let i = 0; i + 40 <= n.length; i += 10) if (c.includes(n.slice(i, i + 40))) return "copied parent-only text";
    } else if (n.length >= 20 && c.includes(n)) return "copied parent-only text";
  }
  return null;
}

export type ValidationResult =
  | { ok: true; content: ActivityContent }
  | { ok: false; errors: { path: string; message: string }[] };

export function validateActivity(input: unknown): ValidationResult {
  const r = activityContentSchema.safeParse(input);
  if (r.success) return { ok: true, content: r.data };
  return {
    ok: false,
    errors: r.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
  };
}

/** The step list for a duration mode: full script, or the authored shorter version. */
export function timelineFor(content: ActivityContent, durationMode: "full" | "short"): ScriptStep[] {
  if (durationMode === "full") return content.scriptSteps;
  const ids = new Set(content.shorterVersion.stepIds);
  return content.scriptSteps.filter((s) => ids.has(s.id));
}
