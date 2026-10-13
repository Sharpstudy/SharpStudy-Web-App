// Child-device projection. Everything sent to a child device goes through here.
// Parent-only fields (parentSays, whyThisWorks, watchFor, misconceptions, interpretation
// guidance, expected/correct answers) are dropped by construction: we build new objects
// from an allow-list rather than deleting keys from the source.
import type { ActivityContent, ChildScreen, Interaction, ScriptStep } from "./schema";
import { timelineFor } from "./schema";

export type ChildInteraction =
  | { type: "done_button" }
  | { type: "ready_button" }
  | { type: "choice"; options: { key: string; label: string; imageKey?: string }[] }
  | { type: "number_entry"; unit?: string }
  | { type: "ordering"; items: { key: string; label: string }[] };

export interface ChildScreenView {
  screen: string;
  imageKey?: string;
  readAloudText?: string;
  interaction?: ChildInteraction;
}

export interface ChildStepView extends ChildScreenView {
  id: string;
  index: number;
  total: number;
  isCheck: boolean;
  isReflect: boolean;
}

export interface ChildCheckView extends ChildScreenView {
  key: "near" | "transfer";
}

export interface ChildActivityView {
  title: string;
  subject: string;
  conceptTags: string[];
  steps: ChildStepView[];
  checks: ChildCheckView[];
}

// Deterministic shuffle so ordering items aren't presented in the correct order.
function seededShuffle<T>(items: T[], seed: string): T[] {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    const j = Math.abs(h) % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export function projectInteraction(inter: Interaction | undefined, seed: string): ChildInteraction | undefined {
  if (!inter) return undefined;
  switch (inter.type) {
    case "done_button":
      return { type: "done_button" };
    case "ready_button":
      return { type: "ready_button" };
    case "choice":
      return {
        type: "choice",
        options: inter.options.map((o) => (o.imageKey ? { key: o.key, label: o.label, imageKey: o.imageKey } : { key: o.key, label: o.label })),
      };
    case "number_entry":
      return inter.unit ? { type: "number_entry", unit: inter.unit } : { type: "number_entry" };
    case "ordering": {
      const items = inter.items.map((i) => ({ key: i.key, label: i.label }));
      let shuffled = seededShuffle(items, seed);
      const correct = inter.correctOrder || inter.items.map((i) => i.key);
      if (shuffled.map((i) => i.key).join() === correct.join()) shuffled = [...shuffled.slice(1), shuffled[0]];
      return { type: "ordering", items: shuffled };
    }
  }
}

function projectScreen(c: ChildScreen, seed: string): ChildScreenView {
  const v: ChildScreenView = { screen: c.screen };
  if (c.imageKey) v.imageKey = c.imageKey;
  if (c.readAloudText) v.readAloudText = c.readAloudText;
  const inter = projectInteraction(c.interaction, seed);
  if (inter) v.interaction = inter;
  return v;
}

export function projectStep(step: ScriptStep, index: number, total: number): ChildStepView {
  return {
    id: step.id,
    index,
    total,
    isCheck: step.parent.phase === "check",
    isReflect: step.parent.phase === "reflect",
    ...projectScreen(step.child, step.id),
  };
}

export function projectActivity(content: ActivityContent, durationMode: "full" | "short" = "full"): ChildActivityView {
  const timeline = timelineFor(content, durationMode);
  return {
    title: content.title,
    subject: content.subject,
    conceptTags: [...content.conceptTags],
    steps: timeline.map((s, i) => projectStep(s, i, timeline.length)),
    checks: content.checkQuestions
      .filter((c) => c.child)
      .map((c) => ({ key: c.key, ...projectScreen(c.child!, `check-${c.key}`) })),
  };
}

/** Names of keys that must never appear anywhere in a child payload. Used by tests and a runtime guard. */
export const PARENT_ONLY_KEYS = [
  "parentSays",
  "whyThisWorks",
  "watchFor",
  "misconceptions",
  "interpretation",
  "parentAsks",
  "correctKey",
  "expected",
  "tolerance",
  "correctOrder",
  "expectedResponses",
  "parentPreview",
  "optionalKit",
  "parentNote",
] as const;

export function findParentOnlyKeys(value: unknown, path = "$"): string[] {
  const found: string[] = [];
  if (Array.isArray(value)) value.forEach((v, i) => found.push(...findParentOnlyKeys(v, `${path}[${i}]`)));
  else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      if ((PARENT_ONLY_KEYS as readonly string[]).includes(k)) found.push(`${path}.${k}`);
      found.push(...findParentOnlyKeys(v, `${path}.${k}`));
    }
  }
  return found;
}

/** Deterministic check of a structured child answer. null = item has no expected answer. */
export function checkAnswer(inter: Interaction | undefined, value: unknown): boolean | null {
  if (!inter) return null;
  switch (inter.type) {
    case "choice":
      if (!inter.correctKey) return null;
      return value === inter.correctKey;
    case "number_entry": {
      if (inter.expected === undefined) return null;
      const n = typeof value === "number" ? value : Number(value);
      if (!Number.isFinite(n)) return false;
      return Math.abs(n - inter.expected) <= (inter.tolerance ?? 0);
    }
    case "ordering":
      if (!inter.correctOrder) return null;
      return Array.isArray(value) && value.join("|") === inter.correctOrder.join("|");
    default:
      return null;
  }
}

/** Validates the *shape* of a child answer for a given interaction. */
export function isValidAnswerShape(inter: Interaction | undefined, value: unknown): boolean {
  if (!inter) return false;
  switch (inter.type) {
    case "done_button":
    case "ready_button":
      return value === true;
    case "choice":
      return typeof value === "string" && inter.options.some((o) => o.key === value);
    case "number_entry":
      return typeof value === "number" && Number.isFinite(value) && Math.abs(value) < 1e7;
    case "ordering":
      return (
        Array.isArray(value) &&
        value.length === inter.items.length &&
        value.every((v) => typeof v === "string") &&
        [...value].sort().join() === inter.items.map((i) => i.key).sort().join()
      );
  }
}
