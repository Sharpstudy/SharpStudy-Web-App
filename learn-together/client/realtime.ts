// Client side of realtime sync. Two transports behind one interface:
//  - Ably (when the server has ABLY_API_KEY): push with channel-scoped tokens.
//  - Polling: always available; used alone when realtime is off or the socket drops.
// Either way the server is authoritative: events only tell us *that* state changed (plus a seq);
// we refetch the state, ignoring anything at or below the seq we already have.
import { useCallback, useEffect, useRef, useState } from "react";
import { decide, isSyncEvent, type SyncEvent } from "@/learn-together/domain/sync";

export type TransportStatus = "connecting" | "live" | "polling";

export interface RealtimeTransport {
  readonly kind: "ably" | "polling";
  subscribe(channel: string, cb: (ev: SyncEvent) => void): () => void;
  onStatus(cb: (connected: boolean) => void): () => void;
  close(): void;
}

class PollingTransport implements RealtimeTransport {
  readonly kind = "polling" as const;
  subscribe() {
    return () => undefined;
  }
  onStatus(cb: (connected: boolean) => void) {
    cb(false);
    return () => undefined;
  }
  close() {}
}

class AblyTransport implements RealtimeTransport {
  readonly kind = "ably" as const;
  private client: any = null;
  private ready: Promise<any>;
  private statusCbs = new Set<(c: boolean) => void>();

  constructor(getToken: () => Promise<unknown>) {
    this.ready = import("ably").then((mod: any) => {
      const Realtime = mod.Realtime || mod.default?.Realtime;
      this.client = new Realtime({
        authCallback: (_: unknown, cb: (err: unknown, token: unknown) => void) => getToken().then((t) => cb(null, t), (e) => cb(e, null)),
        echoMessages: false,
      });
      this.client.connection.on((change: { current: string }) => {
        const connected = change.current === "connected";
        this.statusCbs.forEach((cb) => cb(connected));
      });
      return this.client;
    });
  }

  subscribe(channel: string, cb: (ev: SyncEvent) => void) {
    let ch: any = null;
    const listener = (msg: { data: unknown }) => {
      if (isSyncEvent(msg.data)) cb(msg.data);
    };
    this.ready.then((c) => {
      ch = c.channels.get(channel);
      ch.subscribe(listener);
    });
    return () => ch?.unsubscribe(listener);
  }

  onStatus(cb: (connected: boolean) => void) {
    this.statusCbs.add(cb);
    this.ready.then((c) => cb(c.connection.state === "connected"));
    return () => this.statusCbs.delete(cb);
  }

  close() {
    this.ready.then((c) => c.close()).catch(() => undefined);
  }
}

export function createTransport(enabled: boolean, getToken: () => Promise<unknown>): RealtimeTransport {
  if (!enabled || typeof window === "undefined") return new PollingTransport();
  try {
    return new AblyTransport(getToken);
  } catch {
    return new PollingTransport();
  }
}

interface LiveOptions<T> {
  /** Fetch current state. `since` lets the server answer "unchanged" cheaply. */
  fetchState: (since: number | null) => Promise<T | { unchanged: true; seq: number }>;
  seqOf: (s: T) => number;
  channels: string[];
  realtime: boolean;
  getToken: () => Promise<unknown>;
  pollMs: number;
  livePollMs?: number;
  enabled?: boolean;
  onEvent?: (ev: SyncEvent) => void;
  onReconnect?: () => void;
}

export function useLiveState<T>(opts: LiveOptions<T>) {
  const [state, setState] = useState<T | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [status, setStatus] = useState<TransportStatus>("connecting");
  const lastSeq = useRef<number | null>(null);
  const inflight = useRef<Promise<void> | null>(null);
  const again = useRef(false);
  const optsRef = useRef(opts);
  optsRef.current = opts;

  const refresh = useCallback(async () => {
    if (inflight.current) {
      again.current = true;
      return inflight.current;
    }
    inflight.current = (async () => {
      try {
        const r = await optsRef.current.fetchState(lastSeq.current);
        if (r && (r as { unchanged?: boolean }).unchanged) return;
        const next = r as T;
        const seq = optsRef.current.seqOf(next);
        if (lastSeq.current === null || seq >= lastSeq.current) {
          lastSeq.current = seq;
          setState(next);
        }
        setError(null);
      } catch (e) {
        setError(e);
      } finally {
        inflight.current = null;
        if (again.current) {
          again.current = false;
          void refresh();
        }
      }
    })();
    return inflight.current;
  }, []);

  const channelKey = opts.channels.join("|");
  const enabled = opts.enabled !== false;

  useEffect(() => {
    if (!enabled) return;
    void refresh();
    const transport = createTransport(optsRef.current.realtime, optsRef.current.getToken);
    let connected = false;
    let wasConnected = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const schedule = () => {
      if (timer) clearTimeout(timer);
      const ms = connected ? optsRef.current.livePollMs ?? 15000 : optsRef.current.pollMs;
      timer = setTimeout(async () => {
        if (document.visibilityState !== "hidden") await refresh();
        schedule();
      }, ms);
    };

    const offStatus = transport.onStatus((c) => {
      if (c && !connected && wasConnected) {
        optsRef.current.onReconnect?.();
        void refresh();
      }
      if (c) wasConnected = true;
      connected = c;
      setStatus(c ? "live" : transport.kind === "ably" ? "connecting" : "polling");
      if (!c && transport.kind === "ably") setStatus("polling");
      schedule();
    });

    const unsubs = channelKey
      .split("|")
      .filter(Boolean)
      .map((ch) =>
        transport.subscribe(ch, (ev) => {
          optsRef.current.onEvent?.(ev);
          const d = ev.groupId ? decide(lastSeq.current ?? 0, ev) : "apply";
          if (d !== "ignore") void refresh();
        })
      );

    const onVisible = () => document.visibilityState === "visible" && void refresh();
    const onOnline = () => {
      optsRef.current.onReconnect?.();
      void refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", onOnline);
    schedule();

    return () => {
      if (timer) clearTimeout(timer);
      offStatus();
      unsubs.forEach((u) => u());
      transport.close();
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", onOnline);
    };
  }, [channelKey, enabled, refresh]);

  return { state, error, status, refresh, setState };
}
