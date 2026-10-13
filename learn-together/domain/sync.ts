// Sync protocol shared by server, parent client and child client.
// The server is authoritative: every event carries the group's monotonic `seq`.
// Clients apply an event only if seq > lastSeq; on a gap they refetch state.

export const SYNC_VERSION = 1;

export type SyncEventType =
  | "session.launched"
  | "session.step_changed"
  | "session.paused"
  | "session.resumed"
  | "session.ended"
  | "child.joined"
  | "child.ready"
  | "child.response_submitted"
  | "child.help_raised"
  | "child.help_acknowledged"
  | "presence.changed"
  | "pairing.claimed"
  | "pairing.resolved"
  | "device.revoked";

export interface SyncEvent<P = Record<string, unknown>> {
  v: typeof SYNC_VERSION;
  type: SyncEventType;
  groupId?: string;
  seq: number;
  at: number; // server epoch ms, used for latency measurement
  payload: P;
}

export const channels = {
  child: (childProfileId: string) => `lt:child:${childProfileId}`,
  group: (groupId: string) => `lt:group:${groupId}`,
  family: (familyId: string) => `lt:family:${familyId}`,
};

export type ApplyDecision = "apply" | "ignore" | "resync";

/**
 * Decide what to do with an incoming group event.
 * - seq <= lastSeq: stale or duplicate → ignore
 * - seq === lastSeq + 1: in order → apply
 * - seq > lastSeq + 1: we missed something → resync from server
 * Events without a group (lobby/pairing notices) always apply.
 */
export function decide(lastSeq: number, ev: Pick<SyncEvent, "seq" | "groupId" | "v">): ApplyDecision {
  if (ev.v !== SYNC_VERSION) return "resync";
  if (!ev.groupId) return "apply";
  if (ev.seq <= lastSeq) return "ignore";
  if (ev.seq === lastSeq + 1) return "apply";
  return "resync";
}

export function isSyncEvent(x: unknown): x is SyncEvent {
  return !!x && typeof x === "object" && (x as SyncEvent).v === SYNC_VERSION && typeof (x as SyncEvent).type === "string" && typeof (x as SyncEvent).seq === "number";
}
