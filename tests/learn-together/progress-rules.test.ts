import { describe, expect, it } from "vitest";
import { computeConceptProgress, type ConceptSessionRecord } from "@/learn-together/domain/progress";

const day = (n: number) => new Date(Date.UTC(2026, 0, 1 + n, 15));
const rec = (d: number, outcome: "understood" | "practice_again" | "not_sure" | null, transfer?: "clear" | "partial" | "not_yet"): ConceptSessionRecord => ({
  sessionId: `s${d}`,
  completedAt: day(d),
  outcomes: outcome ? [outcome] : [],
  transferCheck: transfer,
});
const now = day(10);

describe("concept progress rules", () => {
  it("no history → not introduced", () => {
    const r = computeConceptProgress([], now);
    expect(r.status).toBeNull();
    expect(r.sessionsCount).toBe(0);
  });

  it("one session → introduced, even if it went perfectly", () => {
    expect(computeConceptProgress([rec(1, "understood", "clear")], now).status).toBe("introduced");
    expect(computeConceptProgress([rec(1, "not_sure")], now).status).toBe("introduced");
  });

  it("two sessions on two days with understood + clear transfer → confident", () => {
    const r = computeConceptProgress([rec(1, "practice_again", "partial"), rec(3, "understood", "clear")], now);
    expect(r.status).toBe("confident");
    expect(r.explanation).toMatch(/2 sessions on 2 different days/);
  });

  it("two sessions on the same day → practicing", () => {
    const sameDay = [rec(2, "understood", "clear"), { ...rec(2, "understood", "clear"), sessionId: "x", completedAt: new Date(day(2).getTime() + 3600000) }];
    const r = computeConceptProgress(sameDay, now);
    expect(r.status).toBe("practicing");
    expect(r.explanation).toMatch(/two different days/);
  });

  it("most recent not understood, transfer not clear, or practice again → practicing", () => {
    expect(computeConceptProgress([rec(1, "understood", "clear"), rec(3, "not_sure", "clear")], now).status).toBe("practicing");
    expect(computeConceptProgress([rec(1, "understood", "clear"), rec(3, "understood", "partial")], now).status).toBe("practicing");
    expect(computeConceptProgress([rec(1, "understood", "clear"), rec(3, "understood")], now).status).toBe("practicing");
    const mixed = { ...rec(3, "understood", "clear"), outcomes: ["understood", "practice_again"] as never };
    expect(computeConceptProgress([rec(1, "understood", "clear"), mixed], now).status).toBe("practicing");
  });

  it("only the most recent session matters for confident", () => {
    expect(computeConceptProgress([rec(1, "understood", "clear"), rec(3, "practice_again", "not_yet")], now).status).toBe("practicing");
    expect(computeConceptProgress([rec(3, "understood", "clear"), rec(1, "practice_again", "not_yet")], now).status).toBe("confident"); // order-independent input
  });

  it("revisit window: confident and 30+ days since last practice", () => {
    const hist = [rec(1, "understood", "clear"), rec(3, "understood", "clear")];
    expect(computeConceptProgress(hist, day(32)).revisit).toBe(false);
    expect(computeConceptProgress(hist, day(33)).revisit).toBe(true);
    expect(computeConceptProgress([rec(1, "not_sure"), rec(3, "not_sure")], day(90)).revisit).toBe(false);
  });

  it("parent override wins and is labelled", () => {
    const r = computeConceptProgress([rec(1, "not_sure")], now, { status: "confident", at: day(5) });
    expect(r).toMatchObject({ status: "confident", source: "parent_override" });
    expect(r.explanation).toMatch(/Set by a parent/);
    expect(computeConceptProgress([], now, { status: "practicing", at: day(5) }).status).toBe("practicing");
  });
});
