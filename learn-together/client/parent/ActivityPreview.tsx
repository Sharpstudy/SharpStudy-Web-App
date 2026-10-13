import React, { useEffect, useState } from "react";
import { useRouter } from "next/router";
import { parentApi } from "../api";
import { Avatar, Dialog, ErrorNote, LearnShell, Loading, Status, s } from "../ui";
import { conceptLabel } from "../concepts";
import { SUBJECT_ICON } from "../icons";
import { takePreselect, useMe } from "./Home";
import type { ActivitySummary } from "./Explore";

interface Preview extends Omit<ActivitySummary, "saved" | "dismissed"> {
  versionId: string;
  preview: null | {
    parentPreview: string;
    materials: { item: string; householdSubstitution: string; smallParts?: boolean }[];
    noPurchaseRoute: string;
    safety: { hazards: string[]; supervision: string; stopConditions: string[]; cleanup: string } | null;
    optionalKit: { kitKey: string; description: string } | null;
    accessibilityAdaptations: string[];
    shorterVersion: string;
    extension: string;
    steps: number;
  };
}

interface HomeChild {
  id: string;
  nickname: string;
  avatarKey: string;
  ageBand: string;
  deviceStatus: "online" | "offline" | "not_paired";
}

function LaunchDialog({ a, onClose, short }: { a: Preview; onClose: () => void; short: boolean }) {
  const router = useRouter();
  const [kids, setKids] = useState<HomeChild[] | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [duration, setDuration] = useState<"full" | "short">(short ? "short" : "full");
  const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const pre = takePreselect();
    parentApi.get<{ children: HomeChild[] }>("/api/learn/home").then((h) => {
      setKids(h.children);
      if (pre && h.children.some((c) => c.id === pre)) setPicked([pre]);
      else if (h.children.length === 1) setPicked([h.children[0].id]);
    }, setErr);
    const id = setInterval(() => parentApi.get<{ children: HomeChild[] }>("/api/learn/home").then((h) => setKids(h.children)).catch(() => undefined), 5000);
    return () => clearInterval(id);
  }, []);

  const chosen = (kids || []).filter((k) => picked.includes(k.id));
  const allOnline = chosen.length > 0 && chosen.every((k) => k.deviceStatus !== "not_paired");
  const launch = async (mode: "connected" | "single_device") => {
    setBusy(true);
    try {
      const r = await parentApi.post<{ groupId: string }>("/api/learn/groups", { activitySlug: a.slug, childProfileIds: picked, mode, durationMode: duration });
      router.push(`/learn/session/${r.groupId}`);
    } catch (e) {
      setErr(e);
      parentApi.post("/api/learn/analytics", { name: "lt_launch_failed", props: { activityId: a.activityId } }).catch(() => undefined);
      setBusy(false);
    }
  };

  return (
    <Dialog title="Who's learning?" onClose={onClose}>
      <ErrorNote error={err} />
      {!kids ? (
        <Loading />
      ) : (
        <>
          <div role="group" aria-label="Children" style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 16 }}>
            {kids.map((k) => (
              <label key={k.id} style={{ display: "flex", alignItems: "center", gap: 12, minHeight: 52, cursor: "pointer" }}>
                <input type="checkbox" checked={picked.includes(k.id)} onChange={() => setPicked(picked.includes(k.id) ? picked.filter((x) => x !== k.id) : [...picked, k.id])} style={{ width: 22, height: 22 }} />
                <Avatar avatarKey={k.avatarKey} />
                <span>
                  <strong>{k.nickname}</strong>
                  {!a.ageBands.includes(k.ageBand) && <span className={s.muted}> · designed for ages {a.ageBands.join(", ")}</span>}
                  <br />
                  <Status online={k.deviceStatus === "online"} label={k.deviceStatus === "online" ? "Device online" : k.deviceStatus === "offline" ? "Device offline" : "No device paired"} />
                </span>
              </label>
            ))}
          </div>
          <fieldset style={{ marginBottom: 16 }}>
            <legend className={s.muted} style={{ fontSize: 14, fontWeight: 700 }}>
              Length
            </legend>
            <div className={s.segmented}>
              <button type="button" aria-pressed={duration === "full"} onClick={() => setDuration("full")}>
                Full ({a.estimatedMinutes} min)
              </button>
              <button type="button" aria-pressed={duration === "short"} onClick={() => setDuration("short")}>
                Shorter version
              </button>
            </div>
          </fieldset>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <button className={s.btn} disabled={busy || !picked.length || !allOnline} onClick={() => launch("connected")}>
              Send to {chosen.length === 1 ? `${chosen[0].nickname}'s device` : "their devices"}
            </button>
            {chosen.length > 0 && !allOnline && <p className={s.muted}>Pair a device for each child to send it to their screen.</p>}
            {chosen.some((k) => k.deviceStatus === "offline") && allOnline && <p className={s.muted}>A device looks offline. The lesson will open when it comes back.</p>}
            <button className={s.btnGhost} disabled={busy || !picked.length} onClick={() => launch("single_device")}>
              Use this device
            </button>
          </div>
        </>
      )}
    </Dialog>
  );
}

export default function ActivityPreview({ user }: { user: unknown }) {
  const router = useRouter();
  const slug = String(router.query.slug || "");
  const { me, error } = useMe();
  const [a, setA] = useState<Preview | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const [launching, setLaunching] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [report, setReport] = useState<null | "confusion" | "safety_concern">(null);
  const [reportText, setReportText] = useState("");

  useEffect(() => {
    if (me && slug) parentApi.get<Preview>(`/api/learn/activities/${slug}`).then(setA, setErr);
  }, [me, slug]);

  const feedback = async (body: Record<string, unknown>, msg: string) => {
    try {
      await parentApi.post(`/api/learn/activities/${slug}/feedback`, body);
      setNote(msg);
    } catch (e) {
      setErr(e);
    }
  };

  return (
    <LearnShell user={user} title={a?.title || "Activity"}>
      <ErrorNote error={error || err} />
      {note && (
        <div className={s.success} role="status">
          {note}
        </div>
      )}
      {!a ? (
        !err && <Loading />
      ) : (
        <div className="row">
          <div className="col-lg-8">
            <span className={s.subjectTag}>
              <span aria-hidden="true">{SUBJECT_ICON[a.subject]}</span> {a.subject === "math" ? "Real-life maths mission" : "Science at home lab"}
            </span>
            <h1 style={{ fontSize: 32, margin: "6px 0 10px" }}>{a.title}</h1>
            <p style={{ fontSize: 18 }}>{a.learningGoal}</p>
            <p className={s.muted}>
              {a.estimatedMinutes} min · Ages {a.ageBands.join(", ")} · {a.conceptTags.map(conceptLabel).join(", ")}
            </p>
            {a.preview ? (
              <>
                <section className={s.card}>
                  <h2>Why it matters</h2>
                  <p>{a.realWorldHook}</p>
                  <h2 style={{ marginTop: 16 }}>What happens</h2>
                  <p>{a.preview.parentPreview}</p>
                  <p className={s.muted}>
                    {a.preview.steps} short steps. Shorter version: {a.preview.shorterVersion}
                  </p>
                </section>
                <section className={s.card}>
                  <h2>You&apos;ll need</h2>
                  {a.preview.materials.length ? (
                    <ul style={{ paddingLeft: 18 }}>
                      {a.preview.materials.map((m) => (
                        <li key={m.item} style={{ marginBottom: 6 }}>
                          <strong>{m.item}</strong>
                          <br />
                          <span className={s.muted}>Or: {m.householdSubstitution}</span>
                          {m.smallParts && <span className={s.muted}> · small parts: keep away from under-3s</span>}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p>Nothing at all.</p>
                  )}
                  <p className={s.muted}>
                    <strong>No need to buy anything:</strong> {a.preview.noPurchaseRoute}
                  </p>
                </section>
                {a.preview.safety && (
                  <section className={s.card} aria-labelledby="safety-h" style={{ borderColor: "#f3d27a" }}>
                    <h2 id="safety-h">Safety</h2>
                    <p>
                      <strong>Supervision:</strong> {a.preview.safety.supervision}
                    </p>
                    <p style={{ marginBottom: 4 }}>
                      <strong>Hazards</strong>
                    </p>
                    <ul style={{ paddingLeft: 18 }}>
                      {a.preview.safety.hazards.map((h) => (
                        <li key={h}>{h}</li>
                      ))}
                    </ul>
                    <p style={{ marginBottom: 4 }}>
                      <strong>Stop if</strong>
                    </p>
                    <ul style={{ paddingLeft: 18 }}>
                      {a.preview.safety.stopConditions.map((h) => (
                        <li key={h}>{h}</li>
                      ))}
                    </ul>
                    <p>
                      <strong>Clean up:</strong> {a.preview.safety.cleanup}
                    </p>
                  </section>
                )}
                <section className={s.card}>
                  <h2>Making it work for your child</h2>
                  <ul style={{ paddingLeft: 18 }}>
                    {a.preview.accessibilityAdaptations.map((x) => (
                      <li key={x}>{x}</li>
                    ))}
                  </ul>
                  <p className={s.muted}>
                    <strong>Want more?</strong> {a.preview.extension}
                  </p>
                </section>
              </>
            ) : (
              <div className={s.alert}>This activity is included in full pathways.</div>
            )}
          </div>
          <div className="col-lg-4">
            <div className={s.card} style={{ position: "sticky", top: 100 }}>
              <button className={s.btn} style={{ width: "100%" }} disabled={!a.entitled} onClick={() => setLaunching(true)}>
                Start this activity
              </button>
              {a.preview?.optionalKit && (
                <div style={{ marginTop: 16 }}>
                  <p className={s.muted} style={{ marginBottom: 6 }}>
                    <strong>Optional kit.</strong> {a.preview.optionalKit.description} The activity works fully without it.
                  </p>
                  <button
                    className={`${s.btnGhost} ${s.btnSmall}`}
                    onClick={async () => {
                      try {
                        await parentApi.post(`/api/learn/activities/${slug}/kit-interest`, {});
                        setNote("Thanks! We've noted your interest. Nothing to buy now.");
                      } catch (e) {
                        setErr(e);
                      }
                    }}
                  >
                    Tell me about this kit
                  </button>
                </div>
              )}
              <hr />
              <p style={{ fontWeight: 700, marginBottom: 6 }}>Was this activity useful?</p>
              <div className={s.btnRow} role="group" aria-label="Usefulness rating, 1 to 5">
                {[1, 2, 3, 4, 5].map((n) => (
                  <button key={n} className={`${s.btnGhost} ${s.btnSmall}`} onClick={() => feedback({ kind: "usefulness_rating", rating: n }, "Thanks for rating this activity.")} aria-label={`${n} out of 5`}>
                    {n}
                  </button>
                ))}
              </div>
              <div className={s.btnRow} style={{ marginTop: 10 }}>
                <button className={`${s.btnGhost} ${s.btnSmall}`} onClick={() => setReport("confusion")}>
                  Something was confusing
                </button>
                <button className={`${s.btnDanger} ${s.btnSmall}`} onClick={() => setReport("safety_concern")}>
                  Report a safety concern
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      {launching && a && <LaunchDialog a={a} short={router.query.short === "1"} onClose={() => setLaunching(false)} />}
      {report && (
        <Dialog title={report === "confusion" ? "What was confusing?" : "Report a safety concern"} onClose={() => setReport(null)}>
          <div className={s.field}>
            <label htmlFor="report-note">{report === "confusion" ? "Tell us which step and what was unclear." : "Tell us what happened or what worries you. Our content team reviews every report."}</label>
            <textarea id="report-note" rows={4} maxLength={2000} value={reportText} onChange={(e) => setReportText(e.target.value)} />
            <p className={s.hint}>Please don&apos;t include your child&apos;s name or personal details.</p>
          </div>
          <div className={s.btnRow}>
            <button
              className={s.btn}
              onClick={async () => {
                await feedback({ kind: report, note: reportText }, "Thank you. Your report was sent to our content team.");
                setReport(null);
                setReportText("");
              }}
            >
              Send
            </button>
            <button className={s.btnGhost} onClick={() => setReport(null)}>
              Cancel
            </button>
          </div>
        </Dialog>
      )}
    </LearnShell>
  );
}
