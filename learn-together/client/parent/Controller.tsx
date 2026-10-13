// Parent controller: timed script one step at a time, live child panel, checks and reflection.
import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/router";
import { parentApi } from "../api";
import { useLiveState } from "../realtime";
import { Avatar, Dialog, ErrorNote, LearnShell, Loading, PinPad, Status, cx, s } from "../ui";
import { channels } from "@/learn-together/domain/sync";
import { projectActivity } from "@/learn-together/domain/projection";
import { timelineFor, type ActivityContent, type ScriptStep } from "@/learn-together/domain/schema";
import type { Recommendation } from "@/learn-together/domain/recommend";
import Follower from "../kid/Follower";
import { useMe } from "./Home";

interface ChildLive {
  childProfileId: string;
  nickname: string;
  avatarKey: string;
  sessionId: string;
  sessionStatus: string;
  device: { id: string; label: string } | null;
  presence: "online" | "offline" | "this_device";
  joined: boolean;
  ready: boolean;
  lastAckSeq: number;
  responses: { id: string; itemKey: string; value: unknown; isCorrect: boolean | null; at: string }[];
  help: { id: string; stepId: string; raisedAt: string; acknowledgedAt: string | null }[];
  checks: Partial<Record<"near" | "transfer", "clear" | "partial" | "not_yet">>;
  observation: { id: string; outcome: string; parentNote: string | null } | null;
  misconceptionsSeen: { key: string; stepId: string | null }[];
  confidence: number | null;
}

interface GroupState {
  groupId: string;
  seq: number;
  state: "lobby" | "active" | "paused" | "ended";
  mode: "connected" | "single_device";
  durationMode: "full" | "short";
  currentStepIndex: number;
  stepChangedAt: string | null;
  activityId: string;
  content: ActivityContent;
  children: ChildLive[];
  recommendations: Record<string, Recommendation[]>;
}

function describeAnswer(content: ActivityContent, itemKey: string, value: unknown) {
  const [kind, key] = itemKey.split(":");
  const inter = kind === "step" ? content.scriptSteps.find((x) => x.id === key)?.child.interaction : content.checkQuestions.find((c) => c.key === key)?.child?.interaction;
  if (inter?.type === "choice") return inter.options.find((o) => o.key === value)?.label || String(value);
  if (inter?.type === "ordering" && Array.isArray(value)) return value.map((k) => inter.items.find((i) => i.key === k)?.label || k).join(" → ");
  if (inter?.type === "number_entry") return `${value}${inter.unit ? ` ${inter.unit}` : ""}`;
  return value === true ? "Done" : String(value);
}

function useStepTimer(since: string | null, running: boolean) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [running]);
  return since ? Math.max(0, Math.round((now - new Date(since).getTime()) / 1000)) : 0;
}

const mmss = (n: number) => `${Math.floor(n / 60)}:${String(n % 60).padStart(2, "0")}`;
const PHASE_LABEL: Record<string, string> = { connect: "Connect", do: "Do", explain: "Explain", check: "Check", reflect: "Reflect" };

export default function Controller({ user }: { user: unknown }) {
  const router = useRouter();
  const groupId = String(router.query.groupId || "");
  const { me, error: meError } = useMe();
  const [err, setErr] = useState<unknown>(null);
  const [childMode, setChildMode] = useState(false);
  const [exitPin, setExitPin] = useState(false);
  const [pinErr, setPinErr] = useState<unknown>(null);

  const live = useLiveState<GroupState>({
    enabled: !!me && !!groupId,
    fetchState: (since) => parentApi.get(`/api/learn/groups/${groupId}${since !== null ? `?since=${since}` : ""}`),
    seqOf: (g) => g.seq,
    channels: groupId ? [channels.group(groupId)] : [],
    realtime: !!me?.realtime,
    getToken: () => parentApi.get(`/api/learn/realtime/token?groupId=${groupId}`),
    pollMs: 2000,
    onReconnect: () => parentApi.post("/api/learn/analytics", { name: "lt_realtime_reconnect", props: { transport: "ably" } }).catch(() => undefined),
  });
  const g = live.state;
  const timeline: ScriptStep[] = useMemo(() => (g ? timelineFor(g.content, g.durationMode) : []), [g?.content, g?.durationMode]); // eslint-disable-line react-hooks/exhaustive-deps
  const step = timeline[g?.currentStepIndex ?? 0];
  const elapsed = useStepTimer(g?.stepChangedAt || null, g?.state === "active");
  const childView = useMemo(() => (g ? projectActivity(g.content, g.durationMode) : null), [g?.content, g?.durationMode]); // eslint-disable-line react-hooks/exhaustive-deps

  const action = async (type: string, extra: Record<string, unknown> = {}) => {
    try {
      await parentApi.post(`/api/learn/groups/${groupId}/action`, { type, ...extra });
      await live.refresh();
    } catch (e) {
      setErr(e);
    }
  };
  const op = async (name: string, body: Record<string, unknown>) => {
    try {
      await parentApi.post(`/api/learn/groups/${groupId}/${name}`, body);
      await live.refresh();
    } catch (e) {
      setErr(e);
    }
  };

  if (!g || !step || !childView) {
    return (
      <LearnShell user={user} title="Activity">
        <ErrorNote error={meError || live.error} />
        {!live.error && <Loading />}
      </LearnShell>
    );
  }

  const local = g.children.filter((c) => c.presence === "this_device");
  const isCheck = step.parent.phase === "check";
  const isReflect = step.parent.phase === "reflect";
  const over = elapsed > step.parent.suggestedSeconds;

  const localFollower = local.length > 0 && (
    <Follower
      activity={childView}
      state={g.state}
      stepIndex={g.currentStepIndex}
      readAloud={false}
      reducedMotion={false}
      kids={local.map((c) => ({ id: c.childProfileId, nickname: c.nickname, avatarKey: c.avatarKey, ready: c.ready, answered: c.responses.map((r) => r.itemKey), helpPending: c.help.some((h) => !h.acknowledgedAt) }))}
      onReady={(id) => op("ready", { childProfileId: id })}
      onRespond={(id, itemKey, value) => op("respond", { childProfileId: id, itemKey, value })}
      onHelp={(id) => op("help", { childProfileId: id })}
    />
  );

  if (childMode && local.length) {
    return (
      <div className={s.kid}>
        <div className={s.kidTop}>
          <span />
          <button className={s.grownUpBtn} onClick={() => setExitPin(true)}>
            🔒 Grown-up
          </button>
        </div>
        {localFollower}
        {exitPin && (
          <Dialog title="Enter the family PIN" onClose={() => setExitPin(false)}>
            <ErrorNote error={pinErr} />
            <PinPad
              label="Family PIN"
              onSubmit={async (pin) => {
                try {
                  await parentApi.post("/api/learn/family/verify-pin", { pin });
                  setExitPin(false);
                  setChildMode(false);
                  setPinErr(null);
                } catch (e) {
                  setPinErr(e);
                }
              }}
            />
          </Dialog>
        )}
      </div>
    );
  }

  return (
    <LearnShell user={user} title={g.content.title}>
      <ErrorNote error={err} />
      <div className={s.pageHead}>
        <div>
          <h1>{g.content.title}</h1>
          <p>
            <strong>Goal:</strong> {g.content.learningGoal}
          </p>
        </div>
        <span className={s.muted} role="status">
          {live.status === "live" ? "Live" : "Syncing every 2s"} · {g.mode === "connected" ? "Connected devices" : "This device"}
        </span>
      </div>

      <div className={s.controller}>
        <div>
          {g.state === "lobby" && (
            <section className={s.card}>
              <h2>Get ready</h2>
              <p>{g.mode === "connected" ? "The lesson is opening on your child's device. Start when they tap I'm ready." : "Your child can tap I'm ready on this screen, then press Start."}</p>
              <ul style={{ paddingLeft: 18 }}>
                {g.content.materials.map((m) => (
                  <li key={m.item}>
                    {m.item} <span className={s.muted}>(or {m.householdSubstitution})</span>
                  </li>
                ))}
              </ul>
              {g.content.safety && (
                <div className={s.alert}>
                  <strong>Safety:</strong> {g.content.safety.supervision}
                </div>
              )}
              <div className={s.btnRow}>
                <button className={s.btn} onClick={() => action("start")}>
                  Start
                </button>
                <button className={s.btnGhost} onClick={() => action("end", { reason: "abandoned" })}>
                  Cancel
                </button>
              </div>
            </section>
          )}

          {(g.state === "active" || g.state === "paused") && (
            <section className={s.card} aria-labelledby="step-h">
              <div className={s.btnRow} style={{ justifyContent: "space-between" }}>
                <span className={s.phase}>{PHASE_LABEL[step.parent.phase]}</span>
                <span id="step-h" className={s.muted}>
                  Step {g.currentStepIndex + 1} of {timeline.length}
                </span>
                <span className={cx(s.timer, over && s.timerOver)} aria-label={`Time on this step ${mmss(elapsed)}, suggested ${mmss(step.parent.suggestedSeconds)}`}>
                  {mmss(elapsed)} / {mmss(step.parent.suggestedSeconds)}
                </span>
              </div>
              <ol className={s.progressDots} aria-hidden="true">
                {timeline.map((t, i) => (
                  <li key={t.id} className={i < g.currentStepIndex ? s.done : i === g.currentStepIndex ? s.current : undefined} />
                ))}
              </ol>
              {g.state === "paused" && <div className={s.alert}>Paused. Your child sees a short-break screen.</div>}
              <p className={s.says}>{step.parent.parentSays}</p>
              <p className={s.muted} style={{ fontSize: 14 }}>
                Your child sees: “{step.child.screen}”
              </p>

              {step.parent.whyThisWorks && (
                <details className={s.why}>
                  <summary>Why this works</summary>
                  <p>{step.parent.whyThisWorks}</p>
                </details>
              )}

              {(step.parent.watchFor || []).length > 0 && (
                <div className={s.watchFor}>
                  <strong>Watch for</strong>
                  {(step.parent.watchFor || []).map((key) => {
                    const m = g.content.misconceptions.find((x) => x.key === key);
                    if (!m) return null;
                    return (
                      <div key={key} style={{ marginTop: 8 }}>
                        <p style={{ margin: 0 }}>{m.signal}</p>
                        <p className={s.muted} style={{ margin: "2px 0 6px" }}>
                          Try asking: {m.supportiveNextQuestion}
                        </p>
                        <div className={s.btnRow}>
                          {g.children.map((c) => {
                            const seen = c.misconceptionsSeen.some((x) => x.key === key && x.stepId === step.id);
                            return (
                              <button key={c.childProfileId} className={`${s.btnGhost} ${s.btnSmall}`} disabled={seen} onClick={() => op("misconception", { childProfileId: c.childProfileId, misconceptionKey: key, stepId: step.id })}>
                                {seen ? "Noted" : "I saw this"}
                                {g.children.length > 1 ? ` (${c.nickname})` : ""}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {step.parent.phase === "do" && g.content.materials.length > 0 && (
                <details className={s.why}>
                  <summary>Material alternatives</summary>
                  <ul style={{ paddingLeft: 18 }}>
                    {g.content.materials.map((m) => (
                      <li key={m.item}>
                        {m.item}: {m.householdSubstitution}
                      </li>
                    ))}
                  </ul>
                </details>
              )}

              {isCheck && (
                <div style={{ marginTop: 16 }}>
                  {g.content.checkQuestions.map((q) => (
                    <div key={q.key} className={s.card} style={{ background: "#f6fafb" }}>
                      <h3 style={{ fontSize: 17 }}>
                        {q.key === "near" ? "Near question" : "Transfer question"}: {q.parentAsks}
                      </h3>
                      <ul className={s.muted} style={{ paddingLeft: 18, fontSize: 14 }}>
                        <li>
                          <strong>Clear:</strong> {q.interpretation.clear}
                        </li>
                        <li>
                          <strong>Partial:</strong> {q.interpretation.partial}
                        </li>
                        <li>
                          <strong>Not yet:</strong> {q.interpretation.not_yet}
                        </li>
                      </ul>
                      {g.children.map((c) => {
                        const ans = c.responses.filter((r) => r.itemKey === `check:${q.key}`);
                        return (
                          <div key={c.childProfileId} style={{ marginTop: 8 }}>
                            <span style={{ fontWeight: 700 }}>{c.nickname}</span>
                            {ans.length > 0 && <span className={s.muted}> answered: {ans.map((r) => describeAnswer(g.content, r.itemKey, r.value)).join(", then ")}</span>}
                            <div className={s.segmented} role="group" aria-label={`${c.nickname}: ${q.key} question`}>
                              {(["clear", "partial", "not_yet"] as const).map((v) => (
                                <button key={v} aria-pressed={c.checks[q.key] === v} onClick={() => op("check", { childProfileId: c.childProfileId, questionKey: q.key, interpretation: v })}>
                                  {v === "not_yet" ? "Not yet" : v[0].toUpperCase() + v.slice(1)}
                                </button>
                              ))}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ))}
                </div>
              )}

              {isReflect && g.children.map((c) => <ReflectForm key={c.childProfileId} child={c} onSave={(body) => op("reflect", { childProfileId: c.childProfileId, ...body })} />)}

              <div className={s.btnRow} style={{ marginTop: 18 }}>
                <button className={s.btnGhost} onClick={() => action("prev")} disabled={g.currentStepIndex === 0 || g.state !== "active"}>
                  ← Back
                </button>
                <button className={s.btnGhost} onClick={() => action("repeat")} disabled={g.state !== "active"}>
                  Repeat
                </button>
                {g.state === "active" ? (
                  <button className={s.btnGhost} onClick={() => action("pause")}>
                    Pause
                  </button>
                ) : (
                  <button className={s.btnGhost} onClick={() => action("resume")}>
                    Resume
                  </button>
                )}
                {g.currentStepIndex < timeline.length - 1 ? (
                  <button className={s.btn} onClick={() => action("next")} disabled={g.state !== "active"}>
                    Next →
                  </button>
                ) : (
                  <button className={s.btn} onClick={() => action("end", { reason: "completed" })}>
                    Finish
                  </button>
                )}
                <button
                  className={`${s.btnDanger} ${s.btnSmall}`}
                  onClick={() => {
                    if (window.confirm("End this activity now?")) void action("end", { reason: "abandoned" });
                  }}
                >
                  End
                </button>
              </div>
            </section>
          )}

          {g.state === "ended" && (
            <section className={s.card}>
              <h2>Nice work together!</h2>
              {g.children.map((c) => (
                <div key={c.childProfileId} style={{ marginBottom: 16 }}>
                  <p style={{ display: "flex", alignItems: "center", gap: 10, margin: "8px 0" }}>
                    <Avatar avatarKey={c.avatarKey} /> <strong>{c.nickname}</strong>
                    <span className={s.muted}>{c.sessionStatus === "completed" ? "Completed" : "Stopped early"}</span>
                  </p>
                  {!c.observation && c.sessionStatus === "completed" && <ReflectForm child={c} onSave={(body) => op("reflect", { childProfileId: c.childProfileId, ...body })} />}
                  {(g.recommendations[c.childProfileId] || []).map((r) => (
                    <p key={r.slug} style={{ margin: "4px 0" }}>
                      <strong>Next:</strong>{" "}
                      <Link href={`/learn/activity/${r.slug}${r.durationMode === "short" ? "?short=1" : ""}`}>
                        <a>{r.title}</a>
                      </Link>{" "}
                      <span className={s.muted}>— {r.reason}</span>
                    </p>
                  ))}
                  <Link href={`/learn/progress/${c.childProfileId}`}>
                    <a className={`${s.btnGhost} ${s.btnSmall}`}>See {c.nickname}&apos;s progress</a>
                  </Link>
                </div>
              ))}
              <Link href="/learn">
                <a className={s.btn}>Back to home</a>
              </Link>
            </section>
          )}

          {local.length > 0 && g.state !== "ended" && (
            <section className={s.card} aria-label="Child view on this device">
              <div className={s.btnRow} style={{ justifyContent: "space-between" }}>
                <h2 style={{ margin: 0 }}>Child view</h2>
                <button className={`${s.btnGhost} ${s.btnSmall}`} onClick={() => setChildMode(true)}>
                  Hand device to child
                </button>
              </div>
              <div className={s.kid} style={{ minHeight: 360, borderRadius: 14, marginTop: 12 }}>
                {localFollower}
              </div>
            </section>
          )}
        </div>

        <aside aria-label="Children">
          {g.children.map((c) => {
            const pendingHelp = c.help.filter((h) => !h.acknowledgedAt);
            const stepAnswers = c.responses.filter((r) => r.itemKey === `step:${step.id}` || (isCheck && r.itemKey.startsWith("check:")));
            return (
              <section key={c.childProfileId} className={s.childPanel} aria-label={c.nickname}>
                <div className={s.row}>
                  <Avatar avatarKey={c.avatarKey} />
                  <div>
                    <strong>{c.nickname}</strong>
                    <br />
                    {c.presence === "this_device" ? (
                      <span className={s.muted}>On this device</span>
                    ) : (
                      <Status online={c.presence === "online"} label={`${c.device?.label || "Device"} ${c.presence}`} />
                    )}
                  </div>
                </div>
                <p className={s.muted} style={{ margin: "0 0 6px" }}>
                  {c.ready ? "Ready ✓" : c.joined ? "Opened the lesson" : g.mode === "connected" && c.presence !== "this_device" ? "Waiting for the device" : "Not ready yet"}
                  {g.state === "active" && c.presence === "online" && (c.lastAckSeq >= g.seq - 1 ? " · following along" : " · catching up")}
                </p>
                {pendingHelp.map((h) => (
                  <div key={h.id} className={s.helpAlert} role="alert">
                    <span>🙋 {c.nickname} needs help</span>
                    <button className={`${s.btn} ${s.btnSmall}`} onClick={() => op("help-ack", { helpId: h.id })}>
                      Acknowledge
                    </button>
                  </div>
                ))}
                {stepAnswers.length > 0 && (
                  <ul className={s.answers} aria-label="Answers on this step">
                    {stepAnswers.map((r) => (
                      <li key={r.id}>{describeAnswer(g.content, r.itemKey, r.value)}</li>
                    ))}
                  </ul>
                )}
                {c.presence === "offline" && g.state !== "ended" && (
                  <div style={{ marginTop: 10 }}>
                    <p className={s.muted} style={{ marginBottom: 6 }}>
                      The device dropped. You can keep going, wait, or switch.
                    </p>
                    <button className={`${s.btnGhost} ${s.btnSmall}`} onClick={() => op("use-this-device", { childProfileId: c.childProfileId })}>
                      Use this device for {c.nickname}
                    </button>
                  </div>
                )}
              </section>
            );
          })}
        </aside>
      </div>
    </LearnShell>
  );
}

function ReflectForm({ child, onSave }: { child: ChildLive; onSave: (b: Record<string, unknown>) => Promise<void> }) {
  const [outcome, setOutcome] = useState(child.observation?.outcome || "");
  const [note, setNote] = useState(child.observation?.parentNote || "");
  const [confidence, setConfidence] = useState<number | null>(child.confidence);
  const [saved, setSaved] = useState(!!child.observation);
  return (
    <div className={s.card} style={{ background: "#f6fafb", marginTop: 12 }}>
      <h3 style={{ fontSize: 17 }}>How did it go for {child.nickname}?</h3>
      <div className={s.segmented} role="group" aria-label="Outcome">
        {[
          ["understood", "Understood"],
          ["practice_again", "Practice again"],
          ["not_sure", "Not sure"],
        ].map(([v, l]) => (
          <button key={v} aria-pressed={outcome === v} onClick={() => (setOutcome(v), setSaved(false))}>
            {l}
          </button>
        ))}
      </div>
      <div className={s.field} style={{ marginTop: 12 }}>
        <label htmlFor={`note-${child.childProfileId}`}>Private note (optional)</label>
        <textarea id={`note-${child.childProfileId}`} rows={2} maxLength={1000} value={note} onChange={(e) => (setNote(e.target.value), setSaved(false))} />
        <p className={s.hint}>Only grown-ups in your family can see this.</p>
      </div>
      <fieldset>
        <legend className={s.label} style={{ fontSize: 15 }}>
          I felt able to help with this concept
        </legend>
        <div className={s.segmented}>
          {[1, 2, 3, 4, 5].map((n) => (
            <button key={n} aria-pressed={confidence === n} onClick={() => (setConfidence(n), setSaved(false))} aria-label={`${n} of 5`}>
              {n}
            </button>
          ))}
        </div>
      </fieldset>
      <div className={s.btnRow} style={{ marginTop: 12 }}>
        <button
          className={`${s.btn} ${s.btnSmall}`}
          disabled={!outcome}
          onClick={async () => {
            await onSave({ outcome, parentNote: note || null, confidence });
            setSaved(true);
          }}
        >
          Save reflection
        </button>
        {saved && <span className={s.muted}>Saved ✓</span>}
      </div>
    </div>
  );
}
