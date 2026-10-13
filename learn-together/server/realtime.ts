// Server side of the realtime transport. The DB write always happens first; publishing is
// best-effort. Without ABLY_API_KEY this is a no-op and clients rely on polling.
import type { SyncEvent, SyncEventType } from "@/learn-together/domain/sync";
import { SYNC_VERSION } from "@/learn-together/domain/sync";

type AblyRest = {
  channels: { get(name: string): { publish(name: string, data: unknown): Promise<void> } };
  auth: { createTokenRequest(params: Record<string, unknown>): Promise<unknown> };
};

let restPromise: Promise<AblyRest | null> | null = null;

export const realtimeEnabled = () => !!process.env.ABLY_API_KEY;

async function rest(): Promise<AblyRest | null> {
  if (!realtimeEnabled()) return null;
  if (!restPromise) {
    restPromise = import("ably").then((m) => {
      const Ably = (m as unknown as { default?: { Rest: new (o: unknown) => AblyRest }; Rest: new (o: unknown) => AblyRest });
      const Rest = Ably.Rest || Ably.default!.Rest;
      return new Rest({ key: process.env.ABLY_API_KEY });
    });
  }
  return restPromise;
}

export function makeEvent<P extends Record<string, unknown>>(type: SyncEventType, seq: number, payload: P, groupId?: string): SyncEvent<P> {
  return { v: SYNC_VERSION, type, groupId, seq, at: Date.now(), payload };
}

export async function publish(channel: string, ev: SyncEvent) {
  try {
    const r = await rest();
    if (r) await r.channels.get(channel).publish(ev.type, ev);
  } catch (e) {
    // Clients resync by polling; never fail the request because the push failed.
    console.error("[learn-together] realtime publish failed", ev.type, e instanceof Error ? e.message : e);
  }
}

/** Token request scoped to exactly the channels this principal may subscribe to. */
export async function tokenRequest(clientId: string, channels: string[]) {
  const r = await rest();
  if (!r) return null;
  const capability: Record<string, string[]> = {};
  for (const c of channels) capability[c] = ["subscribe"];
  return r.auth.createTokenRequest({ clientId, capability: JSON.stringify(capability), ttl: 10 * 60 * 1000 });
}
