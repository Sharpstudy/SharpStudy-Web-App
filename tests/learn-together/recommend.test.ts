import { describe, expect, it } from "vitest";
import { recommend, type CatalogEntry, type RecommendInput } from "@/learn-together/domain/recommend";
import { hasEntitlement, canAccessTier } from "@/learn-together/domain/entitlements";

const e = (slug: string, o: Partial<CatalogEntry> = {}): CatalogEntry => ({
  activityId: `id-${slug}`,
  slug,
  title: slug.toUpperCase(),
  subject: "math",
  ageBands: ["6-7", "7-8", "8-9"],
  tier: "free",
  difficulty: 2,
  conceptTags: [slug],
  prerequisites: [],
  pathway: {},
  ...o,
});
const catalog = [
  e("budget", { conceptTags: ["money"], prerequisites: ["number_sense"], pathway: { next: "tens", easier: "make10", extension: "budget2" } }),
  e("budget2", { conceptTags: ["money"], difficulty: 3 }),
  e("make10", { conceptTags: ["number_sense"], difficulty: 1 }),
  e("tens", { conceptTags: ["place_value"] }),
  e("coins", { conceptTags: ["money"], difficulty: 1 }),
  e("paid", { conceptTags: ["fractions"], tier: "paid", difficulty: 1 }),
  e("big", { conceptTags: ["data"], ageBands: ["8-9"], difficulty: 1 }),
];
const base: RecommendInput = { catalog, childAgeBand: "7-8", revisitConcepts: [], exploredConcepts: [], completedSlugs: [], dismissedSlugs: [], canAccess: (c) => c.tier === "free", limit: 3 };

describe("recommendation engine", () => {
  it("no history → gentle starters for the age band, every one with a reason", () => {
    const r = recommend(base);
    expect(r.map((x) => x.kind)).toEqual(["starter", "starter", "starter"]);
    expect(r.every((x) => x.reason.length > 10)).toBe(true);
    expect(r.map((x) => x.slug)).not.toContain("big"); // age band
    expect(r.map((x) => x.slug)).not.toContain("paid"); // tier
    expect(r[0].slug).toBe("coins"); // easiest first
  });

  it("understood → extension then next", () => {
    const r = recommend({ ...base, lastSession: { slug: "budget", outcome: "understood" }, exploredConcepts: ["money"], completedSlugs: ["budget"] });
    expect(r.slice(0, 2).map((x) => [x.slug, x.kind])).toEqual([["budget2", "extension"], ["tens", "next"]]);
  });

  it("practice_again → easier sibling then repeat", () => {
    const r = recommend({ ...base, lastSession: { slug: "budget", outcome: "practice_again" }, exploredConcepts: ["money"], completedSlugs: ["budget"] });
    expect(r.slice(0, 2).map((x) => [x.slug, x.kind])).toEqual([["make10", "easier"], ["budget", "repeat"]]);
  });

  it("practice_again without an authored easier activity → easier on same concept", () => {
    const cat = catalog.map((c) => (c.slug === "budget" ? { ...c, pathway: {} } : c));
    const r = recommend({ ...base, catalog: cat, lastSession: { slug: "budget", outcome: "practice_again" } });
    expect(r[0]).toMatchObject({ slug: "coins", kind: "easier" });
  });

  it("not_sure → shorter version then prerequisite", () => {
    const r = recommend({ ...base, lastSession: { slug: "budget", outcome: "not_sure" } });
    expect(r[0]).toMatchObject({ slug: "budget", kind: "shorter", durationMode: "short" });
    expect(r[1]).toMatchObject({ slug: "make10", kind: "prerequisite" });
  });

  it("revisit concepts get spaced-review suggestions", () => {
    const r = recommend({ ...base, revisitConcepts: ["place_value"], exploredConcepts: ["place_value"], completedSlugs: ["tens"] });
    expect(r[0]).toMatchObject({ slug: "tens", kind: "revisit" });
    expect(r[0].reason).toMatch(/revisit/);
  });

  it("respects dismissed, and returns nothing when everything is dismissed", () => {
    const r = recommend({ ...base, lastSession: { slug: "budget", outcome: "understood" }, dismissedSlugs: ["budget2"] });
    expect(r.map((x) => x.slug)).not.toContain("budget2");
    expect(recommend({ ...base, dismissedSlugs: catalog.map((c) => c.slug) })).toEqual([]);
  });

  it("explored children get unexplored concepts first", () => {
    const r = recommend({ ...base, exploredConcepts: ["money", "number_sense"], completedSlugs: ["budget", "make10"] });
    expect(r[0]).toMatchObject({ slug: "tens", kind: "explore" });
  });

  it("never duplicates and respects the limit", () => {
    const r = recommend({ ...base, limit: 10, lastSession: { slug: "budget", outcome: "practice_again" } });
    expect(new Set(r.map((x) => x.slug)).size).toBe(r.length);
    expect(recommend({ ...base, limit: 1 }).length).toBe(1);
  });
});

describe("entitlements", () => {
  it("free tier for everyone signed in, paid only for staff roles today", () => {
    expect(hasEntitlement(null, "activity:free")).toBe(false);
    expect(hasEntitlement({ role: "student" }, "activity:free")).toBe(true);
    expect(hasEntitlement({ role: "student" }, "activity:paid")).toBe(false);
    expect(hasEntitlement({ role: "admin" }, "activity:paid")).toBe(true);
    expect(canAccessTier({ role: "student", ltRoles: ["lt_editor"] }, "paid")).toBe(true);
  });
});
