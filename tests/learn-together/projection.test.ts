import { describe, expect, it } from "vitest";
import { checkAnswer, findParentOnlyKeys, isValidAnswerShape, projectActivity, projectInteraction } from "@/learn-together/domain/projection";
import { loadAllContent } from "./content";

describe("child projection", () => {
  const all = loadAllContent();

  it.each(all.map((a) => [a.slug, a] as const))("%s: no parent-only keys or text reach the child view", (_slug, a) => {
    for (const mode of ["full", "short"] as const) {
      const view = projectActivity(a, mode);
      expect(findParentOnlyKeys(view)).toEqual([]);
      const json = JSON.stringify(view);
      for (const s of a.scriptSteps) {
        expect(json).not.toContain(s.parent.parentSays);
        if (s.parent.whyThisWorks) expect(json).not.toContain(s.parent.whyThisWorks);
      }
      for (const m of a.misconceptions) expect(json).not.toContain(m.signal);
      for (const c of a.checkQuestions) {
        // The question itself may be shown to the child; interpretation guidance never is.
        expect(json).not.toContain(c.interpretation.clear);
        expect(json).not.toContain(c.interpretation.partial);
        expect(json).not.toContain(c.interpretation.not_yet);
      }
      expect(json).not.toContain(a.parentPreview);
    }
  });

  it("strips expected answers from interactions", () => {
    expect(projectInteraction({ type: "choice", options: [{ key: "a", label: "A" }, { key: "b", label: "B" }], correctKey: "a" }, "x")).toEqual({ type: "choice", options: [{ key: "a", label: "A" }, { key: "b", label: "B" }] });
    expect(projectInteraction({ type: "number_entry", expected: 9, tolerance: 0, unit: "dollars" }, "x")).toEqual({ type: "number_entry", unit: "dollars" });
  });

  it("never presents ordering items in the correct order", () => {
    for (const seed of ["a", "b", "c", "order", "zzz"]) {
      const p = projectInteraction({ type: "ordering", items: [{ key: "a", label: "A" }, { key: "b", label: "B" }, { key: "c", label: "C" }], correctOrder: ["a", "b", "c"] }, seed);
      expect(p && p.type === "ordering" && p.items.map((i) => i.key).join()).not.toBe("a,b,c");
    }
  });

  it("checks answers deterministically", () => {
    expect(checkAnswer({ type: "number_entry", expected: 9 }, 9)).toBe(true);
    expect(checkAnswer({ type: "number_entry", expected: 9 }, 8)).toBe(false);
    expect(checkAnswer({ type: "number_entry", expected: 9, tolerance: 1 }, 8)).toBe(true);
    expect(checkAnswer({ type: "number_entry" }, 8)).toBeNull();
    expect(checkAnswer({ type: "choice", options: [{ key: "a", label: "A" }, { key: "b", label: "B" }], correctKey: "a" }, "b")).toBe(false);
    expect(checkAnswer({ type: "choice", options: [{ key: "a", label: "A" }, { key: "b", label: "B" }] }, "b")).toBeNull();
    expect(checkAnswer({ type: "ordering", items: [{ key: "a", label: "A" }, { key: "b", label: "B" }], correctOrder: ["a", "b"] }, ["a", "b"])).toBe(true);
    expect(checkAnswer({ type: "done_button" }, true)).toBeNull();
  });

  it("rejects free text and malformed answers", () => {
    const choice = { type: "choice" as const, options: [{ key: "a", label: "A" }, { key: "b", label: "B" }] };
    expect(isValidAnswerShape(choice, "a")).toBe(true);
    expect(isValidAnswerShape(choice, "hello I am free text")).toBe(false);
    expect(isValidAnswerShape({ type: "number_entry" }, "9")).toBe(false);
    expect(isValidAnswerShape({ type: "number_entry" }, 9)).toBe(true);
    expect(isValidAnswerShape({ type: "done_button" }, "done")).toBe(false);
    expect(isValidAnswerShape({ type: "ordering", items: [{ key: "a", label: "A" }, { key: "b", label: "B" }] }, ["a", "x"])).toBe(false);
    expect(isValidAnswerShape(undefined, true)).toBe(false);
  });
});
