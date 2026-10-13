// Deterministic recommendation engine. Every recommendation carries a human-readable reason.
import type { AgeBand } from "./schema";
import type { ReflectionOutcome } from "./progress";

export interface CatalogEntry {
  activityId: string;
  slug: string;
  title: string;
  subject: string;
  ageBands: AgeBand[];
  tier: "free" | "paid";
  difficulty: number;
  conceptTags: string[];
  prerequisites: string[]; // concept tags
  pathway: { next?: string; easier?: string; extension?: string };
}

export interface LastSession {
  slug: string;
  outcome: ReflectionOutcome;
}

export interface RecommendInput {
  catalog: CatalogEntry[];
  childAgeBand: AgeBand;
  lastSession?: LastSession | null;
  revisitConcepts: string[];
  exploredConcepts: string[];
  completedSlugs: string[];
  dismissedSlugs: string[];
  canAccess: (entry: CatalogEntry) => boolean;
  limit?: number;
}

export type RecommendationKind = "extension" | "next" | "repeat" | "easier" | "shorter" | "prerequisite" | "revisit" | "explore" | "starter";

export interface Recommendation {
  slug: string;
  activityId: string;
  title: string;
  kind: RecommendationKind;
  durationMode: "full" | "short";
  reason: string;
}

const conceptLabel = (tag: string) => tag.replace(/[-_]/g, " ");

export function recommend(input: RecommendInput): Recommendation[] {
  const limit = input.limit ?? 3;
  const bySlug = new Map(input.catalog.map((c) => [c.slug, c]));
  const dismissed = new Set(input.dismissedSlugs);
  const out: Recommendation[] = [];
  const seen = new Set<string>();

  const eligible = (c: CatalogEntry | undefined): c is CatalogEntry =>
    !!c && !dismissed.has(c.slug) && c.ageBands.includes(input.childAgeBand) && input.canAccess(c);

  const push = (c: CatalogEntry | undefined, kind: RecommendationKind, reason: string, durationMode: "full" | "short" = "full") => {
    if (out.length >= limit || !eligible(c) || seen.has(c.slug)) return false;
    seen.add(c.slug);
    out.push({ slug: c.slug, activityId: c.activityId, title: c.title, kind, durationMode, reason });
    return true;
  };

  const last = input.lastSession ? bySlug.get(input.lastSession.slug) : undefined;
  const sameConcept = (tags: string[], exclude: string, maxDifficulty = 3) =>
    input.catalog
      .filter((c) => c.slug !== exclude && c.difficulty <= maxDifficulty && c.conceptTags.some((t) => tags.includes(t)))
      .sort((a, b) => a.difficulty - b.difficulty || a.slug.localeCompare(b.slug));

  if (last && input.lastSession) {
    const t = last.title;
    const concept = conceptLabel(last.conceptTags[0]);
    switch (input.lastSession.outcome) {
      case "understood": {
        push(bySlug.get(last.pathway.extension || ""), "extension", `"${t}" went well — this stretches ${concept} a little further.`);
        push(bySlug.get(last.pathway.next || ""), "next", `Next on the path after "${t}".`);
        break;
      }
      case "practice_again": {
        const easier = bySlug.get(last.pathway.easier || "") || sameConcept(last.conceptTags, last.slug, last.difficulty - 1)[0];
        push(easier, "easier", `A gentler way into ${concept}, since you marked "practice again" after "${t}".`);
        push(last, "repeat", `Repeat "${t}" — a second try often helps ${concept} click.`);
        break;
      }
      case "not_sure": {
        push(last, "shorter", `A shorter version of "${t}" to see how ${concept} is landing.`, "short");
        const prereq = input.catalog
          .filter((c) => c.slug !== last.slug && c.conceptTags.some((tag) => last.prerequisites.includes(tag)))
          .sort((a, b) => a.difficulty - b.difficulty || a.slug.localeCompare(b.slug))[0];
        push(prereq, "prerequisite", `Builds ${prereq ? conceptLabel(prereq.conceptTags[0]) : "a building block"}, which "${t}" relies on.`);
        break;
      }
    }
  }

  for (const tag of input.revisitConcepts) {
    const c = sameConcept([tag], "")[0];
    push(c, "revisit", `Good time to revisit ${conceptLabel(tag)} — it's been a while since you practiced it together.`);
  }

  const explored = new Set(input.exploredConcepts);
  const completed = new Set(input.completedSlugs);
  const fresh = input.catalog
    .filter((c) => !completed.has(c.slug))
    .sort((a, b) => a.difficulty - b.difficulty || a.slug.localeCompare(b.slug));

  if (explored.size === 0) {
    for (const c of fresh) push(c, "starter", `A gentle first activity for ages ${input.childAgeBand}.`);
  } else {
    for (const c of fresh.filter((c) => c.conceptTags.some((tag) => !explored.has(tag))))
      push(c, "explore", `Explores ${conceptLabel(c.conceptTags.find((tag) => !explored.has(tag))!)}, which you haven't tried together yet.`);
    for (const c of fresh) push(c, "explore", `Another way to practice ${conceptLabel(c.conceptTags[0])}.`);
  }

  return out;
}
