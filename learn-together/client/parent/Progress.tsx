// Per-child progress. Descriptive only: no grades, percentages, rankings, streaks or comparisons.
import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/router";
import { download, parentApi } from "../api";
import { Avatar, ErrorNote, LearnShell, Loading, cx, fmtDate, s } from "../ui";
import { conceptIcon, conceptLabel } from "../concepts";
import type { Recommendation } from "@/learn-together/domain/recommend";
import { useMe } from "./Home";

type Interp = "clear" | "partial" | "not_yet" | null;
interface ProgressData {
  child: { id: string; nickname: string; avatarKey: string; ageBand: string };
  thisWeek: { sessionsCompleted: number; learningMinutes: number; subjects: string[] };
  weeklyRhythm: { weekStart: string; sessions: number }[];
  conceptMap: { conceptTag: string; status: "introduced" | "practicing" | "confident"; source: string; sessionsCount: number; lastPracticedAt: string | null; revisit: boolean; explanation: string; checkHistory: { date: string; near: Interp; transfer: Interp }[] }[];
  howDetermined: string[];
  childAnswers: { sessionId: string; title: string; completedAt: string; items: { label: string; attempts: string[]; matchedExpected: boolean | null }[] }[];
  misconceptions: { at: string; activityTitle: string; signal: string; supportiveNextQuestion: string | null; suggestedActivity: { slug: string; title: string } | null }[];
  timeInsights: string[];
  confidenceTrend: { date: string; rating: number; activityTitle: string }[];
  observations: { id: string; title: string; completedAt: string; outcome: string; parentNote: string | null; editedAt: string | null }[];
  recommendations: Recommendation[];
}

const STATUS_LABEL = { introduced: "Introduced", practicing: "Practicing", confident: "Confident" } as const;
const OUTCOME_LABEL: Record<string, string> = { understood: "Understood", practice_again: "Practice again", not_sure: "Not sure" };
const INTERP_LABEL: Record<string, string> = { clear: "clear", partial: "partial", not_yet: "not yet" };

function describeAttempts(attempts: string[], matched: boolean | null) {
  const tried = attempts.length > 1 ? `tried ${attempts.slice(0, -1).join(", then ")}, then ${attempts[attempts.length - 1]}` : `answered ${attempts[0]}`;
  if (matched === null) return tried;
  return `${tried} (${matched ? "matches the expected answer" : "different from the expected answer"})`;
}

export default function Progress({ user }: { user: unknown }) {
  const router = useRouter();
  const childId = String(router.query.childId || "");
  const { me, error } = useMe();
  const [data, setData] = useState<ProgressData | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [showHow, setShowHow] = useState(false);

  const load = useCallback(() => {
    const q = new URLSearchParams();
    if (from) q.set("from", from);
    if (to) q.set("to", to);
    parentApi.get<ProgressData>(`/api/learn/children/${childId}/progress?${q}`).then(setData, setErr);
  }, [childId, from, to]);
  useEffect(() => {
    if (me && childId) load();
  }, [me, childId, load]);

  if (!data) return <LearnShell user={user} title="Progress">{error || err ? <ErrorNote error={error || err} /> : <Loading />}</LearnShell>;
  const max = Math.max(1, ...data.weeklyRhythm.map((w) => w.sessions));
  const name = data.child.nickname;

  return (
    <LearnShell user={user} title={`${name}'s progress`}>
      <ErrorNote error={err} />
      <div className={s.pageHead}>
        <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
          <Avatar avatarKey={data.child.avatarKey} large label={name} />
          <div>
            <h1>{name}&apos;s learning</h1>
            <p>What you&apos;ve explored together, described in plain words.</p>
          </div>
        </div>
        <div className={s.btnRow}>
          <button className={`${s.btnGhost} ${s.btnSmall}`} onClick={() => download(`/api/learn/children/${childId}/export?format=csv`, "learn-together.csv").catch(setErr)}>
            Export CSV
          </button>
          <button className={`${s.btnGhost} ${s.btnSmall}`} onClick={() => download(`/api/learn/children/${childId}/export?format=json`, "learn-together.json").catch(setErr)}>
            Export JSON
          </button>
        </div>
      </div>

      <form
        className={s.btnRow}
        style={{ marginBottom: 20 }}
        onSubmit={(e) => {
          e.preventDefault();
          load();
        }}
        aria-label="Date range"
      >
        <div className={s.field} style={{ margin: 0 }}>
          <label htmlFor="from">From</label>
          <input id="from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div className={s.field} style={{ margin: 0 }}>
          <label htmlFor="to">To</label>
          <input id="to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
        <button className={`${s.btn} ${s.btnSmall}`} style={{ alignSelf: "flex-end" }}>
          Apply
        </button>
      </form>

      <section className={s.card} aria-labelledby="week-h">
        <h2 id="week-h">This week</h2>
        <div className={s.statRow}>
          <div className={s.stat}>
            <strong>{data.thisWeek.sessionsCompleted}</strong> activities together
          </div>
          <div className={s.stat}>
            <strong>{data.thisWeek.learningMinutes} min</strong> of learning time
          </div>
          <div className={s.stat}>
            <strong>{data.thisWeek.subjects.length ? data.thisWeek.subjects.map((x) => (x === "math" ? "Maths" : "Science")).join(" & ") : "—"}</strong> explored
          </div>
        </div>
      </section>

      <section className={s.card} aria-labelledby="rhythm-h">
        <h2 id="rhythm-h">Weekly rhythm</h2>
        <p className={s.muted}>Activities per week over the last 8 weeks. Any rhythm that works for your family is a good one.</p>
        <div className={s.bars} role="img" aria-label={data.weeklyRhythm.map((w) => `Week of ${fmtDate(w.weekStart)}: ${w.sessions}`).join("; ")}>
          {data.weeklyRhythm.map((w) => (
            <div key={w.weekStart} className={s.bar}>
              <span>{w.sessions || ""}</span>
              <span className={s.fill} style={{ height: `${(w.sessions / max) * 100}%` }} />
              <span>{fmtDate(w.weekStart)}</span>
            </div>
          ))}
        </div>
      </section>

      <section className={s.card} aria-labelledby="concepts-h">
        <div className={s.btnRow} style={{ justifyContent: "space-between" }}>
          <h2 id="concepts-h">Concepts</h2>
          <button className={`${s.btnGhost} ${s.btnSmall}`} aria-expanded={showHow} onClick={() => setShowHow(!showHow)}>
            How this is determined
          </button>
        </div>
        {showHow && (
          <ul className={s.muted} style={{ paddingLeft: 18 }}>
            {data.howDetermined.map((h) => (
              <li key={h}>{h}</li>
            ))}
          </ul>
        )}
        {!data.conceptMap.length ? (
          <p className={s.muted}>Concepts appear here after your first completed activity.</p>
        ) : (
          <div className={s.tableWrap}>
            <table className={s.table}>
              <thead>
                <tr>
                  <th scope="col">Concept</th>
                  <th scope="col">Status</th>
                  <th scope="col">Sessions</th>
                  <th scope="col">Last practiced</th>
                  <th scope="col">Checks (near / transfer)</th>
                  <th scope="col">Change</th>
                </tr>
              </thead>
              <tbody>
                {data.conceptMap.map((c) => (
                  <tr key={c.conceptTag}>
                    <td>
                      <span aria-hidden="true">{conceptIcon(c.conceptTag)}</span> {conceptLabel(c.conceptTag)}
                    </td>
                    <td>
                      <span className={cx(s[c.status])} style={{ fontWeight: 700 }}>
                        {STATUS_LABEL[c.status]}
                      </span>
                      {c.source === "parent_override" && <span className={s.muted}> (set by you)</span>}
                      {c.revisit && <div className={s.muted}>Good time to revisit</div>}
                      <div className={s.muted} style={{ fontSize: 13 }}>
                        {c.explanation}
                      </div>
                    </td>
                    <td>{c.sessionsCount}</td>
                    <td>{fmtDate(c.lastPracticedAt)}</td>
                    <td>
                      <span className={s.strip}>
                        {c.checkHistory.map((h, i) => (
                          <span key={i} title={fmtDate(h.date)}>
                            {h.near ? INTERP_LABEL[h.near] : "–"} / {h.transfer ? INTERP_LABEL[h.transfer] : "–"}
                          </span>
                        ))}
                      </span>
                    </td>
                    <td>
                      <label className={s.srOnly} htmlFor={`ov-${c.conceptTag}`}>
                        Change status for {conceptLabel(c.conceptTag)}
                      </label>
                      <select
                        id={`ov-${c.conceptTag}`}
                        value={c.source === "parent_override" ? c.status : ""}
                        onChange={async (e) => {
                          try {
                            await parentApi.put(`/api/learn/children/${childId}/concepts`, { conceptTag: c.conceptTag, status: e.target.value || null });
                            load();
                          } catch (er) {
                            setErr(er);
                          }
                        }}
                        style={{ minHeight: 40 }}
                      >
                        <option value="">Automatic</option>
                        <option value="introduced">Introduced</option>
                        <option value="practicing">Practicing</option>
                        <option value="confident">Confident</option>
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {data.recommendations.length > 0 && (
        <section className={s.card} aria-labelledby="rec-h">
          <h2 id="rec-h">What to try next</h2>
          {data.recommendations.map((r) => (
            <p key={r.slug}>
              <Link href={`/learn/activity/${r.slug}${r.durationMode === "short" ? "?short=1" : ""}`}>
                <a>
                  <strong>{r.title}</strong>
                </a>
              </Link>{" "}
              <span className={s.muted}>— {r.reason}</span>
            </p>
          ))}
        </section>
      )}

      <div className="row">
        <div className="col-lg-6">
          <section className={s.card} aria-labelledby="answers-h">
            <h2 id="answers-h">{name}&apos;s answers</h2>
            {!data.childAnswers.length && <p className={s.muted}>Answers from the child&apos;s screen appear here.</p>}
            {data.childAnswers.map((sess) => (
              <div key={sess.sessionId} style={{ marginBottom: 12 }}>
                <strong>{sess.title}</strong> <span className={s.muted}>{fmtDate(sess.completedAt)}</span>
                <ul style={{ paddingLeft: 18, margin: "4px 0" }}>
                  {sess.items.map((it, i) => (
                    <li key={i}>
                      <span className={s.muted}>{it.label}:</span> {describeAttempts(it.attempts, it.matchedExpected)}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </section>
        </div>
        <div className="col-lg-6">
          <section className={s.card} aria-labelledby="mis-h">
            <h2 id="mis-h">Things you noticed</h2>
            {!data.misconceptions.length && <p className={s.muted}>When you tap &quot;I saw this&quot; during an activity, it shows up here with an idea for what to try.</p>}
            {data.misconceptions.map((m, i) => (
              <div key={i} style={{ marginBottom: 12 }}>
                <p style={{ margin: 0 }}>{m.signal}</p>
                <p className={s.muted} style={{ margin: 0 }}>
                  {m.activityTitle}, {fmtDate(m.at)}
                  {m.supportiveNextQuestion && <> · Try asking: {m.supportiveNextQuestion}</>}
                </p>
                {m.suggestedActivity && (
                  <Link href={`/learn/activity/${m.suggestedActivity.slug}`}>
                    <a>Try “{m.suggestedActivity.title}”</a>
                  </Link>
                )}
              </div>
            ))}
          </section>
          {data.timeInsights.length > 0 && (
            <section className={s.card} aria-labelledby="time-h">
              <h2 id="time-h">Where time went</h2>
              <ul style={{ paddingLeft: 18 }}>
                {data.timeInsights.map((t) => (
                  <li key={t}>{t}</li>
                ))}
              </ul>
              <p className={s.muted}>Longer steps often mean deep thinking. That&apos;s a good thing.</p>
            </section>
          )}
          <section className={s.card} aria-labelledby="conf-h">
            <h2 id="conf-h">Your confidence helping</h2>
            {!data.confidenceTrend.length ? (
              <p className={s.muted}>Your own 1–5 ratings from the end of each activity appear here.</p>
            ) : (
              <p>
                {data.confidenceTrend.map((c, i) => (
                  <span key={i} className={s.chip} style={{ marginRight: 4 }} title={`${c.activityTitle}, ${fmtDate(c.date)}`}>
                    {fmtDate(c.date)}: {c.rating}/5
                  </span>
                ))}
              </p>
            )}
          </section>
        </div>
      </div>

      <section className={s.card} aria-labelledby="obs-h">
        <h2 id="obs-h">Your reflections</h2>
        {!data.observations.length && <p className={s.muted}>No reflections in this date range.</p>}
        {data.observations.map((o) => (
          <ObservationRow key={o.id} o={o} onChanged={load} onError={setErr} />
        ))}
      </section>
    </LearnShell>
  );
}

function ObservationRow({ o, onChanged, onError }: { o: ProgressData["observations"][number]; onChanged: () => void; onError: (e: unknown) => void }) {
  const [editing, setEditing] = useState(false);
  const [outcome, setOutcome] = useState(o.outcome);
  const [note, setNote] = useState(o.parentNote || "");
  return (
    <div style={{ borderBottom: "1px solid #e3ebf2", padding: "10px 0" }}>
      <strong>{o.title}</strong> <span className={s.muted}>{fmtDate(o.completedAt)}</span> · {OUTCOME_LABEL[o.outcome]}
      {o.editedAt && <span className={s.muted}> (edited)</span>}
      {o.parentNote && !editing && <p style={{ margin: "4px 0" }}>{o.parentNote}</p>}
      {editing ? (
        <div style={{ marginTop: 8 }}>
          <div className={s.segmented}>
            {Object.entries(OUTCOME_LABEL).map(([v, l]) => (
              <button key={v} aria-pressed={outcome === v} onClick={() => setOutcome(v)}>
                {l}
              </button>
            ))}
          </div>
          <div className={s.field} style={{ marginTop: 8 }}>
            <label htmlFor={`obs-${o.id}`}>Private note</label>
            <textarea id={`obs-${o.id}`} rows={2} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
          <div className={s.btnRow}>
            <button
              className={`${s.btn} ${s.btnSmall}`}
              onClick={async () => {
                try {
                  await parentApi.patch(`/api/learn/observations/${o.id}`, { outcome, parentNote: note || null });
                  setEditing(false);
                  onChanged();
                } catch (e) {
                  onError(e);
                }
              }}
            >
              Save
            </button>
            <button className={`${s.btnGhost} ${s.btnSmall}`} onClick={() => setEditing(false)}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className={s.btnRow} style={{ marginTop: 4 }}>
          <button className={`${s.btnGhost} ${s.btnSmall}`} onClick={() => setEditing(true)}>
            Edit
          </button>
          <button
            className={`${s.btnDanger} ${s.btnSmall}`}
            onClick={async () => {
              if (!window.confirm("Remove this reflection? Concept status will be recalculated.")) return;
              try {
                await parentApi.del(`/api/learn/observations/${o.id}`);
                onChanged();
              } catch (e) {
                onError(e);
              }
            }}
          >
            Remove
          </button>
        </div>
      )}
    </div>
  );
}
