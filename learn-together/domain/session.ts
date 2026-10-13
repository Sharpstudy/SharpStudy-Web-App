// Session-group state machine. Pure: the server persists the result and broadcasts the event.

export type GroupState = "lobby" | "active" | "paused" | "ended";
export type GroupMode = "connected" | "single_device";
export type DurationMode = "full" | "short";

export interface GroupSnapshot {
  state: GroupState;
  currentStepIndex: number;
  stepCount: number;
  seq: number;
}

export type GroupAction =
  | { type: "start" }
  | { type: "next" }
  | { type: "prev" }
  | { type: "goto"; index: number }
  | { type: "repeat" }
  | { type: "pause" }
  | { type: "resume" }
  | { type: "end"; reason?: "completed" | "abandoned" };

export type GroupEventType =
  | "session.launched"
  | "session.step_changed"
  | "session.paused"
  | "session.resumed"
  | "session.ended";

export interface TransitionResult {
  next: GroupSnapshot;
  event: { type: GroupEventType; payload: Record<string, unknown> };
}

export class InvalidTransition extends Error {
  constructor(public readonly from: GroupState, public readonly action: GroupAction["type"]) {
    super(`cannot ${action} while ${from}`);
  }
}

const clamp = (i: number, n: number) => Math.max(0, Math.min(n - 1, i));

/** Applies an action. Never auto-advances; every step change is an explicit parent action. */
export function transition(s: GroupSnapshot, action: GroupAction): TransitionResult {
  const bump = (patch: Partial<GroupSnapshot>): GroupSnapshot => ({ ...s, ...patch, seq: s.seq + 1 });
  const fail = () => {
    throw new InvalidTransition(s.state, action.type);
  };

  switch (action.type) {
    case "start":
      if (s.state !== "lobby") fail();
      return { next: bump({ state: "active", currentStepIndex: 0 }), event: { type: "session.step_changed", payload: { stepIndex: 0, started: true } } };
    case "next":
    case "prev":
    case "goto": {
      if (s.state !== "active") fail();
      const target =
        action.type === "next" ? s.currentStepIndex + 1 : action.type === "prev" ? s.currentStepIndex - 1 : action.index;
      const index = clamp(target, s.stepCount);
      return { next: bump({ currentStepIndex: index }), event: { type: "session.step_changed", payload: { stepIndex: index } } };
    }
    case "repeat":
      if (s.state !== "active") fail();
      return { next: bump({}), event: { type: "session.step_changed", payload: { stepIndex: s.currentStepIndex, repeat: true } } };
    case "pause":
      if (s.state !== "active") fail();
      return { next: bump({ state: "paused" }), event: { type: "session.paused", payload: {} } };
    case "resume":
      if (s.state !== "paused") fail();
      return { next: bump({ state: "active" }), event: { type: "session.resumed", payload: { stepIndex: s.currentStepIndex } } };
    case "end":
      if (s.state === "ended") fail();
      return { next: bump({ state: "ended" }), event: { type: "session.ended", payload: { reason: action.reason || "completed" } } };
  }
}

/** A session counts as completed when the group reached a reflect step before ending. */
export function reachedReflection(phases: string[], maxStepIndexReached: number): boolean {
  return phases.slice(0, maxStepIndexReached + 1).includes("reflect");
}
