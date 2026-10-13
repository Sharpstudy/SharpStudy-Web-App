// Child-device pages: join (pairing), lobby + journey, and the session follower.
// No settings, purchases, external links or profile management here. Leaving needs the family PIN.
import React, { useCallback, useEffect, useRef, useState } from "react";
import Head from "next/head";
import { useRouter } from "next/router";
import { ApiError, kidApi } from "../api";
import { useLiveState } from "../realtime";
import { t } from "../i18n";
import { conceptIcon, conceptLabel } from "../concepts";
import { PICTURE_ICONS } from "../icons";
import { Avatar, Dialog, ErrorNote, PinPad, cx, s } from "../ui";
import { channels } from "@/learn-together/domain/sync";
import type { ChildActivityView } from "@/learn-together/domain/projection";
import Follower from "./Follower";

// ---------- clock offset for latency measurement ----------
let clockOffset = 0;
async function heartbeat(groupId: string | null, ackSeq?: number) {
  const t0 = Date.now();
  const r = await kidApi.post<{ now: number }>("/api/learn/kid/heartbeat", { groupId, ackSeq });
  const t1 = Date.now();
  clockOffset = r.now - (t0 + t1) / 2;
}
const serverNow = () => Date.now() + clockOffset;
const report = (name: "lt_launch_received" | "lt_step_sync" | "lt_realtime_reconnect", latencyMs?: number, transport?: string) =>
  kidApi.post("/api/learn/kid/analytics", { name, latencyMs: latencyMs === undefined ? undefined : Math.max(0, Math.round(latencyMs)), transport }).catch(() => undefined);

function useServiceWorker() {
  useEffect(() => {
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("/learn-sw.js", { scope: "/learn/" }).catch(() => undefined);
  }, []);
}

export function KidHead({ title }: { title: string }) {
  return (
    <Head>
      <title>{`${title} · Sharp Study`}</title>
      <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
      <link rel="manifest" href="/learn-manifest.webmanifest" />
      <meta name="theme-color" content="#286bad" />
      <meta name="apple-mobile-web-app-capable" content="yes" />
      <meta name="apple-mobile-web-app-title" content="Learn Together" />
      <link rel="apple-touch-icon" href="/images/learn-together/icon-192.png" />
      <meta name="robots" content="noindex" />
    </Head>
  );
}

// ---------- Join ----------
export function Join() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [phase, setPhase] = useState<"enter" | "waiting" | "denied" | "expired">("enter");
  const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  useServiceWorker();

  const submit = useCallback(
    async (value: string) => {
      setBusy(true);
      setErr(null);
      try {
        await kidApi.post("/api/learn/kid/pairing/claim", { code: value });
        setPhase("waiting");
      } catch (e) {
        setErr(e);
      } finally {
        setBusy(false);
      }
    },
    []
  );

  useEffect(() => {
    const c = typeof router.query.c === "string" ? router.query.c : "";
    if (c) {
      // Don't leave the code in history.
      window.history.replaceState(null, "", "/learn/join");
      setCode(c.toUpperCase().slice(0, 6));
      void submit(c);
    } else {
      kidApi.get<{ status: string }>("/api/learn/kid/pairing/status").then((r) => r.status === "waiting_for_approval" && setPhase("waiting")).catch(() => undefined);
    }
  }, [router.query.c, submit]);

  useEffect(() => {
    if (phase !== "waiting") return;
    const id = setInterval(async () => {
      try {
        const r = await kidApi.get<{ status: string }>("/api/learn/kid/pairing/status");
        if (r.status === "paired") router.replace("/learn/kid");
        else if (r.status === "denied") setPhase("denied");
        else if (r.status === "expired" || r.status === "none") setPhase("expired");
      } catch {
        /* keep polling */
      }
    }, 2000);
    return () => clearInterval(id);
  }, [phase, router]);

  return (
    <div className={s.kid} id="lt-kid">
      <KidHead title={t("join.title")} />
      <main className={s.kidMain}>
        <img src="/images/sharpstudy.png" alt="Sharp Study" style={{ maxWidth: 220 }} />
        {phase === "enter" && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void submit(code);
            }}
            style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 16 }}
          >
            <h1 className={s.kidScreen}>{t("join.enterCode")}</h1>
            <label htmlFor="code" className={s.srOnly}>
              Pairing code
            </label>
            <input
              id="code"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6))}
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              inputMode="text"
              style={{ fontSize: 40, letterSpacing: "0.3em", textAlign: "center", width: 300, maxWidth: "90vw", padding: 10, borderRadius: 14, border: "3px solid #286bad", fontFamily: "ui-monospace, Menlo, monospace" }}
            />
            <ErrorNote error={err} />
            <button className={s.bigBtn} disabled={busy || code.length !== 6}>
              Join
            </button>
          </form>
        )}
        {phase === "waiting" && (
          <div className={s.pop} role="status">
            <div style={{ fontSize: 72 }} aria-hidden="true">
              ⏳
            </div>
            <h1 className={s.kidScreen}>{t("join.waiting")}</h1>
          </div>
        )}
        {(phase === "denied" || phase === "expired") && (
          <div role="status">
            <h1 className={s.kidScreen}>{phase === "denied" ? t("join.denied") : t("join.expired")}</h1>
            <button className={s.bigBtn} onClick={() => (setCode(""), setPhase("enter"))}>
              Try again
            </button>
          </div>
        )}
      </main>
    </div>
  );
}

// ---------- shared shell with the grown-up (PIN) menu ----------
interface KidMe {
  deviceLabel: string;
  realtime: boolean;
  activeChildId: string | null;
  children: { id: string; nickname: string; avatarKey: string; hasPictureCode: boolean; readAloud: boolean; largeText: boolean; reducedMotion: boolean; journey: { conceptTag: string; isNew: boolean; exploredAgain: boolean }[] }[];
  groups: { groupId: string; seq: number; state: string; launchedAt: string; childProfileIds: string[] }[];
}

function GrownUpMenu({ onClose, multiChild, onSwitched }: { onClose: () => void; multiChild: boolean; onSwitched: () => void }) {
  const router = useRouter();
  const [pin, setPin] = useState<string | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const go = async (action: "unlock" | "switch_child" | "unpair") => {
    try {
      await kidApi.post("/api/learn/kid/exit", { pin, action });
      if (action === "unpair") router.replace("/learn/join");
      else if (action === "switch_child") {
        onSwitched();
        onClose();
      } else router.push("/learn");
    } catch (e) {
      setErr(e);
      setPin(null);
    }
  };
  return (
    <Dialog title="Grown-ups only" onClose={onClose}>
      <ErrorNote error={err} />
      {!pin ? (
        <>
          <p className={s.muted}>Enter the family PIN.</p>
          <PinPad label="Family PIN" onSubmit={setPin} />
        </>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {multiChild && (
            <button className={s.btnGhost} onClick={() => go("switch_child")}>
              Switch child
            </button>
          )}
          <button className={s.btnGhost} onClick={() => go("unlock")}>
            Leave child mode (go to the parent area)
          </button>
          <button className={s.btnDanger} onClick={() => go("unpair")}>
            Unpair this device
          </button>
        </div>
      )}
    </Dialog>
  );
}

function useKidMe(onEvent?: () => void) {
  const router = useRouter();
  const [realtime, setRealtime] = useState(false);
  const [childIds, setChildIds] = useState<string[]>([]);
  const live = useLiveState<KidMe>({
    fetchState: async () => {
      try {
        const me = await kidApi.get<KidMe>("/api/learn/kid/me");
        setRealtime(me.realtime);
        setChildIds(me.children.map((c) => c.id));
        return me;
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) router.replace("/learn/join");
        throw e;
      }
    },
    seqOf: () => 0,
    channels: childIds.map(channels.child),
    realtime,
    getToken: () => kidApi.get("/api/learn/kid/realtime/token"),
    pollMs: 3000,
    onEvent: (ev) => {
      if (ev.type === "device.revoked") router.replace("/learn/join");
      onEvent?.();
    },
  });
  return live;
}

// ---------- Lobby ----------
export function Lobby() {
  const router = useRouter();
  const live = useKidMe();
  const me = live.state;
  const [menu, setMenu] = useState(false);
  const [codeFor, setCodeFor] = useState<string | null>(null);
  const [code, setCode] = useState<string[]>([]);
  const [err, setErr] = useState<unknown>(null);
  const opened = useRef<string | null>(null);
  useServiceWorker();

  useEffect(() => {
    void heartbeat(null).catch(() => undefined);
    const id = setInterval(() => heartbeat(null).catch(() => undefined), 20000);
    return () => clearInterval(id);
  }, []);

  const active = me?.children.find((c) => c.id === me.activeChildId) || null;
  const group = me?.groups.find((g) => (active ? g.childProfileIds.includes(active.id) : true));

  // A lesson launched to this child opens automatically.
  useEffect(() => {
    if (!group || opened.current === group.groupId || !active) return;
    opened.current = group.groupId;
    void report("lt_launch_received", serverNow() - new Date(group.launchedAt).getTime(), live.status === "live" ? "ably" : "polling");
    const timer = setTimeout(() => router.push(`/learn/kid/session/${group.groupId}`), active.reducedMotion ? 0 : 900);
    return () => clearTimeout(timer);
  }, [group, active, router, live.status]);

  const select = async (childId: string, pictureCode?: string[]) => {
    try {
      await kidApi.post("/api/learn/kid/select-child", { childProfileId: childId, pictureCode });
      setCodeFor(null);
      setCode([]);
      setErr(null);
      await live.refresh();
    } catch (e) {
      if (e instanceof ApiError && e.code === "picture_code_required") setCodeFor(childId);
      else {
        setErr(e);
        setCode([]);
      }
    }
  };

  if (!me) return <div className={s.kid} aria-busy="true" />;

  return (
    <div className={cx(s.kid, active?.largeText && s.large, active?.reducedMotion && s.reduceMotion)} id="lt-kid">
      <KidHead title="Learn Together" />
      <div className={s.kidTop}>
        <img src="/images/sharpstudy.png" alt="Sharp Study" style={{ maxWidth: 150 }} />
        <button className={s.grownUpBtn} onClick={() => setMenu(true)}>
          🔒 {t("kid.grownUp")}
        </button>
      </div>
      <main className={s.kidMain}>
        <ErrorNote error={err} />
        {!active ? (
          codeFor ? (
            <>
              <h1 className={s.kidScreen}>Tap your picture code</h1>
              <p style={{ fontSize: 40, minHeight: 50 }} aria-live="polite">
                {code.map((c) => PICTURE_ICONS[c]).join(" ") || " "}
              </p>
              <div className={s.choiceGrid} style={{ maxWidth: 420 }}>
                {Object.entries(PICTURE_ICONS).map(([k, icon]) => (
                  <button
                    key={k}
                    aria-label={k}
                    onClick={() => {
                      const next = [...code, k];
                      setCode(next);
                      if (next.length === 3) void select(codeFor, next);
                    }}
                  >
                    <span style={{ fontSize: 40 }} aria-hidden="true">
                      {icon}
                    </span>
                  </button>
                ))}
              </div>
              <button className={s.grownUpBtn} onClick={() => (setCodeFor(null), setCode([]))}>
                Back
              </button>
            </>
          ) : (
            <>
              <h1 className={s.kidScreen}>Who&apos;s here?</h1>
              <div className={s.avatarPick}>
                {me.children.map((c) => (
                  <button key={c.id} onClick={() => select(c.id)}>
                    <Avatar avatarKey={c.avatarKey} large label={c.nickname} />
                    {c.nickname}
                  </button>
                ))}
              </div>
            </>
          )
        ) : (
          <>
            <div className={s.pop} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
              <Avatar avatarKey={active.avatarKey} large label={active.nickname} />
              <h1 className={s.kidScreen}>Hi {active.nickname}!</h1>
              <p role="status" aria-live="polite" style={{ margin: 0 }}>
                {group ? "Here we go!" : t("kid.waiting")}
              </p>
            </div>
            <section aria-labelledby="journey-h" style={{ width: "100%" }}>
              <h2 id="journey-h" style={{ fontSize: 22, marginTop: 20 }}>
                {t("kid.journey")}
              </h2>
              {active.journey.length ? (
                <ul className={s.journey}>
                  {active.journey.map((j) => (
                    <li key={j.conceptTag} className={cx(j.isNew && s.isNew, j.exploredAgain && s.again)}>
                      <span className={s.icon} aria-hidden="true">
                        {conceptIcon(j.conceptTag)}
                      </span>
                      {conceptLabel(j.conceptTag)}
                      {j.isNew && <span className={s.srOnly}> (new)</span>}
                      {j.exploredAgain && <span className={s.srOnly}> (explored again)</span>}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className={s.muted}>Your adventures will appear here.</p>
              )}
            </section>
          </>
        )}
      </main>
      {menu && <GrownUpMenu onClose={() => setMenu(false)} multiChild={me.children.length > 1} onSwitched={() => void live.refresh()} />}
    </div>
  );
}

// ---------- Session ----------
interface KidGroup {
  groupId: string;
  seq: number;
  state: "lobby" | "active" | "paused" | "ended";
  currentStepIndex: number;
  stepChangedAt: string | null;
  activity: ChildActivityView;
  children: { id: string; nickname: string; avatarKey: string; readAloud: boolean; largeText: boolean; reducedMotion: boolean; ready: boolean; answered: string[]; helpPending: boolean }[];
}

export function KidSession() {
  const router = useRouter();
  const groupId = String(router.query.groupId || "");
  const [realtime, setRealtime] = useState(false);
  const [menu, setMenu] = useState(false);
  const lastStep = useRef<string | null>(null);
  const seqRef = useRef(0);
  useServiceWorker();

  useEffect(() => {
    kidApi.get<{ realtime: boolean }>("/api/learn/kid/me").then((m) => setRealtime(m.realtime), () => router.replace("/learn/join"));
  }, [router]);

  const [childIds, setChildIds] = useState<string[]>([]);
  const live = useLiveState<KidGroup>({
    enabled: !!groupId,
    fetchState: async () => {
      try {
        const st = await kidApi.get<KidGroup>(`/api/learn/kid/groups/${groupId}`);
        const ids = st.children.map((c) => c.id);
        setChildIds((prev) => (prev.join() === ids.join() ? prev : ids));
        return st;
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) router.replace("/learn/join");
        if (e instanceof ApiError && e.status === 404) router.replace("/learn/kid");
        throw e;
      }
    },
    seqOf: (g) => g.seq,
    // Child channels carry this group's events (child-safe payloads only).
    channels: childIds.map(channels.child),
    realtime,
    getToken: () => kidApi.get("/api/learn/kid/realtime/token"),
    pollMs: 1000,
    livePollMs: 10000,
    onEvent: (ev) => ev.type === "device.revoked" && router.replace("/learn/join"),
    onReconnect: () => void report("lt_realtime_reconnect", undefined, realtime ? "ably" : "polling"),
  });
  const g = live.state;

  // Join once per child; heartbeat with the last seq we saw.
  const kidKey = g?.children.map((c) => c.id).join(",");
  useEffect(() => {
    if (!g) return;
    g.children.forEach((c) => kidApi.post(`/api/learn/kid/groups/${groupId}/join`, { childProfileId: c.id }).catch(() => undefined));
  }, [kidKey, groupId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (g) seqRef.current = g.seq;
  }, [g]);
  useEffect(() => {
    if (!groupId) return;
    const beat = () => heartbeat(groupId, seqRef.current).catch(() => undefined);
    void beat();
    const id = setInterval(beat, 15000);
    return () => clearInterval(id);
  }, [groupId]);

  // Step-change propagation latency (sampled).
  useEffect(() => {
    if (!g || g.state !== "active" || !g.stepChangedAt) return;
    const key = `${g.currentStepIndex}:${g.stepChangedAt}`;
    if (lastStep.current === key) return;
    const first = lastStep.current === null;
    lastStep.current = key;
    if (!first && Math.random() < 0.5) void report("lt_step_sync", serverNow() - new Date(g.stepChangedAt).getTime(), live.status === "live" ? "ably" : "polling");
  }, [g, live.status]);

  // After the close screen, go back to the lobby.
  useEffect(() => {
    if (g?.state !== "ended") return;
    const id = setTimeout(() => router.replace("/learn/kid"), 10000);
    return () => clearTimeout(id);
  }, [g?.state, router]);

  if (!g) return <div className={s.kid} aria-busy="true" />;
  const prefs = g.children[0];
  return (
    <div className={cx(s.kid, prefs?.largeText && s.large, prefs?.reducedMotion && s.reduceMotion)} id="lt-kid">
      <KidHead title={g.activity.title} />
      <div className={s.kidTop}>
        <span className={s.muted} style={{ fontSize: 16 }}>
          {g.activity.title}
        </span>
        <button className={s.grownUpBtn} onClick={() => setMenu(true)}>
          🔒 {t("kid.grownUp")}
        </button>
      </div>
      <Follower
        activity={g.activity}
        state={g.state}
        stepIndex={g.currentStepIndex}
        kids={g.children}
        readAloud={g.children.some((c) => c.readAloud)}
        reducedMotion={g.children.some((c) => c.reducedMotion)}
        offline={!!live.error}
        onReady={(id) => kidApi.post(`/api/learn/kid/groups/${groupId}/ready`, { childProfileId: id }).then(live.refresh)}
        onRespond={(id, itemKey, value) => kidApi.post(`/api/learn/kid/groups/${groupId}/respond`, { childProfileId: id, itemKey, value }).then(live.refresh)}
        onHelp={(id) => kidApi.post(`/api/learn/kid/groups/${groupId}/help`, { childProfileId: id }).then(live.refresh)}
        onFinished={() => router.replace("/learn/kid")}
      />
      {menu && <GrownUpMenu onClose={() => setMenu(false)} multiChild={false} onSwitched={() => undefined} />}
    </div>
  );
}
