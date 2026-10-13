import { describe, expect, it } from "vitest";
import { applyFilters, DEFAULT_FILTERS, type ActivitySummary } from "@/learn-together/client/parent/filters";
import { gate } from "@/learn-together/server/page";

const a = (o: Partial<ActivitySummary>): ActivitySummary => ({
  activityId: "x", slug: "x", tier: "free", title: "x", subject: "math", activityType: "real_life_math_mission", ageBands: ["7-8"], estimatedMinutes: 10,
  learningGoal: "", conceptTags: [], realWorldHook: "", materialsNeed: "household", lowMess: true, setting: "indoor", hasOptionalKit: false,
  entitled: true, saved: false, dismissed: false, ...o,
});
const list = [
  a({ slug: "m10", estimatedMinutes: 10 }),
  a({ slug: "m15", estimatedMinutes: 15, lowMess: false }),
  a({ slug: "sci", subject: "science", activityType: "science_at_home_lab", hasOptionalKit: true, materialsNeed: "kit_optional", setting: "either" }),
  a({ slug: "none", materialsNeed: "none", setting: "outdoor" }),
  a({ slug: "hidden", dismissed: true }),
  a({ slug: "saved", saved: true }),
];
const slugs = (f: Partial<typeof DEFAULT_FILTERS>) => applyFilters(list, { ...DEFAULT_FILTERS, ...f }).map((x) => x.slug);

describe("explore filters combine", () => {
  it("each filter and combinations", () => {
    expect(slugs({})).toEqual(["m10", "m15", "sci", "none", "saved"]);
    expect(slugs({ subject: "science" })).toEqual(["sci"]);
    expect(slugs({ maxMinutes: 10, lowMess: true })).toEqual(["m10", "sci", "none", "saved"]);
    expect(slugs({ materials: "kit" })).toEqual(["sci"]);
    expect(slugs({ materials: "none" })).toEqual(["none"]);
    expect(slugs({ setting: "outdoor" })).toEqual(["sci", "none"]);
    expect(slugs({ setting: "outdoor", subject: "math" })).toEqual(["none"]);
    expect(slugs({ showDismissed: true })).toContain("hidden");
    expect(slugs({ savedOnly: true })).toEqual(["saved"]);
  });
});

describe("page gate", () => {
  it("returns 404 for every page kind when the flag is off", async () => {
    process.env.FEATURE_LEARN_TOGETHER = "false";
    try {
      for (const k of ["parent", "admin", "kid", "join", "public"] as const) {
        const ctx = { req: { headers: {} }, res: { setHeader() {} }, resolvedUrl: "/learn/" } as never;
        expect(await gate(k)(ctx)).toEqual({ notFound: true });
      }
    } finally {
      process.env.FEATURE_LEARN_TOGETHER = "true";
    }
  });
  it("redirects signed-out parents to sign-in and unpaired devices to join", async () => {
    const ctx = (url: string) => ({ req: { headers: {} }, res: { setHeader() {} }, resolvedUrl: url }) as never;
    expect(await gate("parent")(ctx("/learn/explore/"))).toEqual({ redirect: { destination: "/auth?next=%2Flearn%2Fexplore%2F", permanent: false } });
    expect(await gate("kid")(ctx("/learn/kid/"))).toEqual({ redirect: { destination: "/learn/join", permanent: false } });
  });
});
