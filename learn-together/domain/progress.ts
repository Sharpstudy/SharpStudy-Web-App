// Concept-progress rules. Pure and descriptive: no scores, no percentages.

export type ConceptStatus = "introduced" | "practicing" | "confident";
export type ReflectionOutcome = "understood" | "practice_again" | "not_sure";
export type CheckInterpretation = "clear" | "partial" | "not_yet";

export const REVISIT_AFTER_DAYS = 30;

/** One completed session that touched the concept. */
export interface ConceptSessionRecord {
  sessionId: string;
  completedAt: Date;
  /** Outcomes recorded by the parent for this concept in this session (usually one). */
  outcomes: ReflectionOutcome[];
  transferCheck?: CheckInterpretation;
}

export interface ConceptOverride {
  status: ConceptStatus;
  at: Date;
}

export interface ConceptProgressResult {
  status: ConceptStatus | null; // null = never introduced
  source: "computed" | "parent_override";
  sessionsCount: number;
  lastPracticedAt: Date | null;
  revisit: boolean;
  explanation: string;
}

const dayKey = (d: Date) => d.toISOString().slice(0, 10); // UTC calendar day

export function computeConceptProgress(
  sessions: ConceptSessionRecord[],
  now: Date,
  override?: ConceptOverride | null
): ConceptProgressResult {
  const sorted = [...sessions].sort((a, b) => a.completedAt.getTime() - b.completedAt.getTime());
  const sessionsCount = sorted.length;
  const last = sorted[sessionsCount - 1];
  const lastPracticedAt = last ? last.completedAt : null;

  let status: ConceptStatus | null;
  let explanation: string;

  if (!last) {
    status = null;
    explanation = "Not explored yet.";
  } else {
    const days = new Set(sorted.map((s) => dayKey(s.completedAt))).size;
    const recentUnderstood = last.outcomes.includes("understood");
    const recentNoPracticeAgain = !last.outcomes.includes("practice_again");
    const recentTransferClear = last.transferCheck === "clear";

    if (sessionsCount >= 2 && days >= 2 && recentUnderstood && recentTransferClear && recentNoPracticeAgain) {
      status = "confident";
      explanation = `Explored in ${sessionsCount} sessions on ${days} different days. In the most recent session you noted "understood" and the transfer question went clearly.`;
    } else if (sessionsCount === 1 && !(recentUnderstood && recentTransferClear)) {
      status = "introduced";
      explanation = "Explored once so far.";
    } else if (sessionsCount === 1) {
      status = "introduced";
      explanation = "Explored once so far. Another session on a different day would show it's settling in.";
    } else {
      status = "practicing";
      const missing: string[] = [];
      if (days < 2) missing.push("sessions on at least two different days");
      if (!recentUnderstood) missing.push('"understood" in the most recent session');
      if (!recentTransferClear) missing.push("a clear transfer question in the most recent session");
      if (!recentNoPracticeAgain) missing.push('no "practice again" in the most recent session');
      explanation = `Explored in ${sessionsCount} sessions. Still building: ${missing.join("; ")}.`;
    }
  }

  let source: ConceptProgressResult["source"] = "computed";
  if (override) {
    status = override.status;
    source = "parent_override";
    explanation = `Set by a parent on ${dayKey(override.at)}.`;
  }

  const revisit =
    status === "confident" &&
    !!lastPracticedAt &&
    now.getTime() - lastPracticedAt.getTime() >= REVISIT_AFTER_DAYS * 86400000;
  if (revisit) explanation += ` Last practiced over ${REVISIT_AFTER_DAYS} days ago — a good time to revisit.`;

  return { status, source, sessionsCount, lastPracticedAt, revisit, explanation };
}

export const STATUS_LABELS: Record<ConceptStatus, string> = {
  introduced: "Introduced",
  practicing: "Practicing",
  confident: "Confident",
};

export const HOW_STATUS_IS_DETERMINED = [
  "Introduced: at least one completed session with this concept.",
  "Practicing: more sessions have happened, but the Confident criteria aren't met yet.",
  'Confident: at least 2 completed sessions on 2 different days, and in the most recent session the reflection was "understood", the transfer question was "clear", and nothing was marked "practice again".',
  "Good time to revisit: Confident, but not practiced in 30 or more days.",
  "You can change any status yourself; changes are labelled as set by a parent.",
];
