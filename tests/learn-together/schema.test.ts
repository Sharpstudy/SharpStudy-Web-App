import { describe, expect, it } from "vitest";
import { findParentOnlyReference, validateActivity, timelineFor } from "@/learn-together/domain/schema";
import { loadAllContent, raw } from "./content";

const errorsOf = (c: unknown) => {
  const r = validateActivity(c);
  return r.ok ? [] : r.errors.map((e) => `${e.path}: ${e.message}`);
};

describe("content schema", () => {
  it("accepts every seed activity", () => {
    const all = loadAllContent();
    expect(all.length).toBe(15);
    expect(all.filter((a) => a.subject === "math").length).toBe(11);
    expect(all.filter((a) => a.subject === "science").length).toBe(4);
  });

  it("only ships MVP activity types", () => {
    for (const a of loadAllContent()) expect(["real_life_math_mission", "science_at_home_lab"]).toContain(a.activityType);
  });

  it("accepts future activity types in the schema", () => {
    expect(errorsOf({ ...raw("snack-budget"), activityType: "logic_gym" })).toEqual([]);
  });

  it("rejects a required kit", () => {
    const c = raw("paper-shape-coin-lab");
    c.optionalKit.required = true;
    expect(errorsOf(c).join()).toMatch(/optionalKit\.required/);
  });

  it("rejects a missing no-purchase route", () => {
    const c = raw("snack-budget");
    delete c.noPurchaseRoute;
    expect(errorsOf(c).join()).toMatch(/noPurchaseRoute/);
    c.noPurchaseRoute = "   ";
    expect(errorsOf(c).join()).toMatch(/noPurchaseRoute/);
  });

  it("rejects science without a safety block", () => {
    const c = raw("sink-or-float");
    delete c.safety;
    expect(errorsOf(c).join()).toMatch(/safety block/);
  });

  it("rejects a script with no check or no reflect phase", () => {
    const c = raw("snack-budget");
    c.scriptSteps = c.scriptSteps.filter((s: any) => s.parent.phase !== "check");
    c.shorterVersion.stepIds = ["hook", "reflect"];
    expect(errorsOf(c).join()).toMatch(/'check' phase/);
    const d = raw("snack-budget");
    d.scriptSteps = d.scriptSteps.filter((s: any) => s.parent.phase !== "reflect");
    d.shorterVersion.stepIds = ["hook", "check"];
    expect(errorsOf(d).join()).toMatch(/'reflect' phase/);
  });

  it("rejects check question count other than two, and wrong keys", () => {
    const c = raw("snack-budget");
    c.checkQuestions = [c.checkQuestions[0]];
    expect(errorsOf(c).join()).toMatch(/exactly two/);
    const d = raw("snack-budget");
    d.checkQuestions[1].key = "near";
    expect(errorsOf(d).join()).toMatch(/one 'near' and one 'transfer'/);
  });

  it("rejects child-facing fields that reference parent-only content", () => {
    const c = raw("snack-budget");
    c.scriptSteps[2].child.screen = c.scriptSteps[2].parent.parentSays.slice(0, 120);
    expect(errorsOf(c).join()).toMatch(/references parent-only content/);
    const d = raw("snack-budget");
    d.scriptSteps[0].child.readAloudText = "Watch for counting mistakes";
    expect(errorsOf(d).join()).toMatch(/readAloudText references parent-only/);
    expect(findParentOnlyReference("Parent: say this", [])).not.toBeNull();
    expect(findParentOnlyReference("Tap when ready", ["Something the parent says that is long enough"])).toBeNull();
  });

  it("rejects unknown watchFor keys, bad correct keys and bad shorter-version step ids", () => {
    const c = raw("snack-budget");
    c.scriptSteps[2].parent.watchFor = ["nope"];
    c.scriptSteps[3].child.interaction.correctKey = "zzz";
    c.shorterVersion.stepIds = ["hook", "ghost"];
    const errs = errorsOf(c).join();
    expect(errs).toMatch(/unknown misconception 'nope'/);
    expect(errs).toMatch(/correctKey must match/);
    expect(errs).toMatch(/unknown step id 'ghost'/);
  });

  it("builds the short timeline from shorterVersion", () => {
    const a = loadAllContent().find((x) => x.slug === "snack-budget")!;
    expect(timelineFor(a, "short").map((s) => s.id)).toEqual(["hook", "first_pick", "check", "reflect"]);
    expect(timelineFor(a, "full").length).toBe(a.scriptSteps.length);
  });

  it("science content keeps to safe household materials with choking notes for small parts", () => {
    for (const a of loadAllContent()) {
      const text = JSON.stringify(a).toLowerCase();
      for (const banned of ["flame", "candle", "stove", "bleach", "vinegar", "knife", "boiling", "eat the", "taste"]) expect(text.includes(banned), `${a.slug}: ${banned}`).toBe(false);
      if (a.materials.some((m) => m.smallParts) && a.safety) expect(a.safety.supervision.toLowerCase()).toContain("choking");
    }
  });

  it("money activities use pretend prices only", () => {
    const a = loadAllContent().find((x) => x.slug === "snack-budget")!;
    expect(a.parentPreview.toLowerCase()).toMatch(/fictional|made-up|pretend/);
  });
});
