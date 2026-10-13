import { describe, expect, it } from "vitest";
import { InvalidTransition, transition, type GroupSnapshot } from "@/learn-together/domain/session";
import { decide, isSyncEvent, SYNC_VERSION } from "@/learn-together/domain/sync";

const s0: GroupSnapshot = { state: "lobby", currentStepIndex: 0, stepCount: 5, seq: 1 };

describe("session state machine", () => {
  it("starts, moves, clamps, pauses, resumes and ends with monotonic seq", () => {
    let s = transition(s0, { type: "start" }).next;
    expect(s).toMatchObject({ state: "active", currentStepIndex: 0, seq: 2 });
    s = transition(s, { type: "next" }).next;
    expect(s.currentStepIndex).toBe(1);
    s = transition(s, { type: "prev" }).next;
    s = transition(s, { type: "prev" }).next;
    expect(s.currentStepIndex).toBe(0); // clamped
    s = transition(s, { type: "goto", index: 99 }).next;
    expect(s.currentStepIndex).toBe(4); // clamped
    const rep = transition(s, { type: "repeat" });
    expect(rep.event.payload).toMatchObject({ repeat: true, stepIndex: 4 });
    expect(rep.next.currentStepIndex).toBe(4);
    s = transition(rep.next, { type: "pause" }).next;
    expect(s.state).toBe("paused");
    expect(() => transition(s, { type: "next" })).toThrow(InvalidTransition);
    s = transition(s, { type: "resume" }).next;
    const end = transition(s, { type: "end" });
    expect(end.next.state).toBe("ended");
    expect(end.event).toMatchObject({ type: "session.ended", payload: { reason: "completed" } });
    expect(end.next.seq).toBe(10);
    expect(() => transition(end.next, { type: "end" })).toThrow(InvalidTransition);
  });

  it("rejects invalid transitions", () => {
    expect(() => transition(s0, { type: "next" })).toThrow(InvalidTransition);
    expect(() => transition(s0, { type: "resume" })).toThrow(InvalidTransition);
    const active = transition(s0, { type: "start" }).next;
    expect(() => transition(active, { type: "start" })).toThrow(InvalidTransition);
    expect(() => transition(active, { type: "resume" })).toThrow(InvalidTransition);
    expect(transition(s0, { type: "end", reason: "abandoned" }).event.payload).toEqual({ reason: "abandoned" });
  });
});

describe("sync seq handling", () => {
  const ev = (seq: number, groupId: string | undefined = "g") => ({ v: SYNC_VERSION, seq, groupId });
  it("applies in-order, ignores stale/duplicate, resyncs on gaps", () => {
    expect(decide(4, ev(5))).toBe("apply");
    expect(decide(4, ev(4))).toBe("ignore");
    expect(decide(4, ev(2))).toBe("ignore");
    expect(decide(4, ev(7))).toBe("resync");
    expect(decide(0, { v: SYNC_VERSION, seq: 0, groupId: undefined })).toBe("apply");
    expect(decide(4, { v: 99 as never, seq: 5, groupId: "g" })).toBe("resync");
  });
  it("recognises sync events", () => {
    expect(isSyncEvent({ v: 1, type: "session.paused", seq: 1, at: 0, payload: {} })).toBe(true);
    expect(isSyncEvent({ type: "x" })).toBe(false);
    expect(isSyncEvent(null)).toBe(false);
  });
});
