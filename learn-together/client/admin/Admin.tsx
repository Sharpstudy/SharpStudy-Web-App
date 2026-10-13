// Content admin (role-gated, lazy-loaded): activities, editor with live validation and previews,
// reviews, publishing, version history, rollback, roles, and the product-metrics dashboard.
import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/router";
import { parentApi } from "../api";
import { ErrorNote, LearnShell, Loading, fmtDateTime, s, cx } from "../ui";
import { validateActivity, type ActivityContent } from "@/learn-together/domain/schema";
import { projectActivity } from "@/learn-together/domain/projection";
import Follower from "../kid/Follower";

interface Row {
  id: string;
  slug: string;
  subject: string;
  tier: string;
  status: string;
  title: string;
  currentPublishedVersionId: string | null;
  latestVersion: { id: string; version: number; reviewState: string } | null;
  confusionReports: number;
  safetyConcerns: number;
}

export function AdminList({ user, ltRoles }: { user: unknown; ltRoles: string[] }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const [draft, setDraft] = useState("");
  const isAdmin = ltRoles.includes("lt_admin");
  useEffect(() => {
    parentApi.get<{ activities: Row[] }>("/api/learn/admin/activities").then((r) => setRows(r.activities), setErr);
  }, []);
  return (
    <LearnShell user={user} title="Content admin" admin>
      <div className={s.pageHead}>
        <div>
          <h1>Activities</h1>
          <p>Every version needs subject, developmental, accessibility and editorial review (plus safety for science) before it can be published.</p>
        </div>
      </div>
      <ErrorNote error={err} />
      {!rows ? (
        <Loading />
      ) : (
        <div className={s.card}>
          <div className={s.tableWrap}>
            <table className={s.table}>
              <thead>
                <tr>
                  <th scope="col">Activity</th>
                  <th scope="col">Status</th>
                  <th scope="col">Latest version</th>
                  <th scope="col">Tier</th>
                  <th scope="col">Reports</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <Link href={`/learn/admin/${r.id}`}>
                        <a>
                          <strong>{r.title}</strong>
                        </a>
                      </Link>
                      <div className={s.muted}>
                        {r.slug} · {r.subject}
                      </div>
                    </td>
                    <td>{r.status}</td>
                    <td>{r.latestVersion ? `v${r.latestVersion.version} · ${r.latestVersion.reviewState.replace("_", " ")}` : "—"}</td>
                    <td>{r.tier}</td>
                    <td>
                      {r.confusionReports > 0 && <span className={s.chip}>{r.confusionReports} confusing</span>} {r.safetyConcerns > 0 && <span className={s.chip} style={{ color: "#b3261e" }}>{r.safetyConcerns} safety</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      <section className={s.card}>
        <h2>New activity</h2>
        <p className={s.muted}>Paste activity JSON (see docs/learn-together/CONTENT_GUIDE.md). It&apos;s saved as a draft.</p>
        <textarea aria-label="New activity JSON" value={draft} onChange={(e) => setDraft(e.target.value)} rows={6} style={{ width: "100%", fontFamily: "monospace" }} />
        <button
          className={s.btn}
          disabled={!draft.trim()}
          onClick={async () => {
            try {
              const r = await parentApi.post<{ activityId: string }>("/api/learn/admin/activities", { content: JSON.parse(draft) });
              window.location.href = `/learn/admin/${r.activityId}`;
            } catch (e) {
              setErr(e instanceof SyntaxError ? new Error("That isn't valid JSON") : e);
            }
          }}
        >
          Create draft
        </button>
      </section>
      {isAdmin && <Roles />}
    </LearnShell>
  );
}

function Roles() {
  const [rows, setRows] = useState<{ role: string; email: string; name: string }[]>([]);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("lt_editor");
  const [err, setErr] = useState<unknown>(null);
  const load = () => parentApi.get<{ assignments: typeof rows }>("/api/learn/admin/roles").then((r) => setRows(r.assignments), setErr);
  useEffect(() => {
    void load();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <section className={s.card}>
      <h2>Content roles</h2>
      <ErrorNote error={err} />
      <ul style={{ paddingLeft: 18 }}>
        {rows.map((r) => (
          <li key={r.email + r.role}>
            {r.email} — {r.role}{" "}
            <button
              className={`${s.btnGhost} ${s.btnSmall}`}
              onClick={async () => {
                await parentApi.del("/api/learn/admin/roles", null, { email: r.email, role: r.role }).catch(setErr);
                void load();
              }}
            >
              Remove
            </button>
          </li>
        ))}
      </ul>
      <form
        className={s.btnRow}
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            await parentApi.post("/api/learn/admin/roles", { email, role });
            setEmail("");
            void load();
          } catch (er) {
            setErr(er);
          }
        }}
      >
        <label className={s.srOnly} htmlFor="role-email">
          Email
        </label>
        <input id="role-email" type="email" placeholder="user@email" value={email} onChange={(e) => setEmail(e.target.value)} required style={{ minHeight: 44, padding: 8, flex: "1 1 220px" }} />
        <label className={s.srOnly} htmlFor="role-role">
          Role
        </label>
        <select id="role-role" value={role} onChange={(e) => setRole(e.target.value)} style={{ minHeight: 44 }}>
          <option value="lt_editor">Editor</option>
          <option value="lt_reviewer">Reviewer</option>
          <option value="lt_admin">Admin</option>
        </select>
        <button className={s.btn}>Grant</button>
      </form>
    </section>
  );
}

interface Detail {
  activity: { id: string; slug: string; subject: string; tier: string; status: string; currentPublishedVersionId: string | null };
  versions: {
    id: string;
    version: number;
    reviewState: string;
    createdBy: string | null;
    publishedAt: string | null;
    updatedAt: string;
    content: ActivityContent;
    reviews: { required: string[]; latest: Record<string, { decision: string; notes: string | null; at: string }>; history: { type: string; decision: string; notes: string | null; at: string }[]; ready: boolean };
  }[];
  feedback: { kind: string; note: string | null; at: string }[];
}

function ParentPreview({ c }: { c: ActivityContent }) {
  return (
    <div>
      <h3 style={{ fontSize: 18 }}>{c.title}</h3>
      <p className={s.muted}>{c.parentPreview}</p>
      <ol style={{ paddingLeft: 18 }}>
        {c.scriptSteps.map((st) => (
          <li key={st.id} style={{ marginBottom: 8 }}>
            <span className={s.phase}>{st.parent.phase}</span> <span className={s.muted}>{st.parent.suggestedSeconds}s</span>
            <div>{st.parent.parentSays}</div>
            {st.parent.whyThisWorks && <div className={s.muted}>Why: {st.parent.whyThisWorks}</div>}
            {st.parent.watchFor?.length ? <div className={s.muted}>Watch for: {st.parent.watchFor.join(", ")}</div> : null}
          </li>
        ))}
      </ol>
    </div>
  );
}

export function AdminEditor({ user, ltRoles }: { user: unknown; ltRoles: string[] }) {
  const router = useRouter();
  const id = String(router.query.id || "");
  const [d, setD] = useState<Detail | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const [text, setText] = useState("");
  const [vid, setVid] = useState<string | null>(null);
  const [stepIdx, setStepIdx] = useState(0);
  const [notes, setNotes] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const can = (r: string) => ltRoles.includes("lt_admin") || ltRoles.includes(r);

  const load = async () => {
    try {
      const det = await parentApi.get<Detail>(`/api/learn/admin/activities/${id}`);
      setD(det);
      const v = det.versions[0];
      setVid(v.id);
      setText(JSON.stringify(v.content, null, 2));
    } catch (e) {
      setErr(e);
    }
  };
  useEffect(() => {
    if (id) void load();
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  const parsed = useMemo(() => {
    try {
      return { json: JSON.parse(text) as unknown, error: null as string | null };
    } catch (e) {
      return { json: null, error: (e as Error).message };
    }
  }, [text]);
  const validation = useMemo(() => (parsed.json ? validateActivity(parsed.json) : null), [parsed.json]);
  const valid = validation?.ok ? validation.content : null;
  const childView = useMemo(() => (valid ? projectActivity(valid, "full") : null), [valid]);
  const v = d?.versions.find((x) => x.id === vid);
  const editable = v && v.reviewState === "draft";

  const op = async (body: Record<string, unknown>, done: string) => {
    try {
      await parentApi.post(`/api/learn/admin/activities/${id}`, body);
      setMsg(done);
      setNotes("");
      await load();
    } catch (e) {
      setErr(e);
    }
  };

  if (!d || !v) return <LearnShell user={user} title="Edit activity" admin>{err ? <ErrorNote error={err} /> : <Loading />}</LearnShell>;

  return (
    <LearnShell user={user} title={`Edit ${d.activity.slug}`} admin>
      <div className={s.pageHead}>
        <div>
          <h1>{v.content.title}</h1>
          <p>
            {d.activity.slug} · {d.activity.status} · tier {d.activity.tier}
          </p>
        </div>
        <div className={s.btnRow}>
          {can("lt_admin") && d.activity.status !== "retired" && (
            <button className={`${s.btnDanger} ${s.btnSmall}`} onClick={() => window.confirm("Retire this activity? Parents will no longer see it.") && op({ op: "retire" }, "Retired.")}>
              Retire
            </button>
          )}
          {can("lt_admin") && (
            <button className={`${s.btnGhost} ${s.btnSmall}`} onClick={() => op({ op: "tier", tier: d.activity.tier === "free" ? "paid" : "free" }, "Tier changed.")}>
              Make {d.activity.tier === "free" ? "paid" : "free"}
            </button>
          )}
        </div>
      </div>
      <ErrorNote error={err} />
      {msg && (
        <div className={s.success} role="status">
          {msg}
        </div>
      )}

      <div className={s.card}>
        <label htmlFor="ver" className={s.label} style={{ fontWeight: 700, marginRight: 8 }}>
          Version
        </label>
        <select
          id="ver"
          value={vid || ""}
          onChange={(e) => {
            const nv = d.versions.find((x) => x.id === e.target.value)!;
            setVid(nv.id);
            setText(JSON.stringify(nv.content, null, 2));
          }}
          style={{ minHeight: 40 }}
        >
          {d.versions.map((x) => (
            <option key={x.id} value={x.id}>
              v{x.version} · {x.reviewState}
              {x.id === d.activity.currentPublishedVersionId ? " (live)" : ""}
            </option>
          ))}
        </select>
        {v.publishedAt && v.id !== d.activity.currentPublishedVersionId && can("lt_admin") && (
          <button className={`${s.btnGhost} ${s.btnSmall}`} style={{ marginLeft: 10 }} onClick={() => window.confirm(`Roll back to v${v.version}? New launches will use it immediately.`) && op({ op: "rollback", versionId: v.id }, `Rolled back to v${v.version}.`)}>
            Roll back to this version
          </button>
        )}
      </div>

      <div className={s.editor}>
        <div>
          <textarea aria-label="Activity JSON" value={text} onChange={(e) => setText(e.target.value)} readOnly={!editable && !can("lt_editor")} spellCheck={false} />
          <div aria-live="polite">
            {parsed.error && <div className={s.error}>JSON: {parsed.error}</div>}
            {validation && !validation.ok && (
              <div className={s.error}>
                <strong>{validation.errors.length} schema problem(s)</strong>
                <ul style={{ paddingLeft: 18, margin: 0 }}>
                  {validation.errors.slice(0, 20).map((e, i) => (
                    <li key={i}>
                      <code>{e.path || "(root)"}</code>: {e.message}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {valid && <div className={s.success}>Schema valid.</div>}
          </div>
          {can("lt_editor") && (
            <div className={s.btnRow}>
              <button
                className={s.btn}
                disabled={!valid}
                onClick={async () => {
                  try {
                    await parentApi.put(`/api/learn/admin/activities/${id}`, { content: valid });
                    setMsg(editable ? "Draft saved." : "Saved as a new draft version.");
                    await load();
                  } catch (e) {
                    setErr(e);
                  }
                }}
              >
                {editable ? "Save draft" : "Save as new draft"}
              </button>
              {(v.reviewState === "draft" || v.reviewState === "rejected") && (
                <button className={s.btnGhost} onClick={() => op({ op: "request_reviews", versionId: v.id }, "Reviews requested.")}>
                  Request reviews
                </button>
              )}
              {v.reviewState === "approved" && (
                <button className={s.btn} onClick={() => op({ op: "publish", versionId: v.id }, "Published.")}>
                  Publish
                </button>
              )}
            </div>
          )}
        </div>
        <div>
          <section className={s.card}>
            <h2>Reviews</h2>
            <ul style={{ paddingLeft: 0, listStyle: "none" }}>
              {v.reviews.required.map((r) => (
                <li key={r} style={{ marginBottom: 6 }}>
                  <strong>{r}</strong>: {v.reviews.latest[r]?.decision?.replace("_", " ") || "not requested"}
                </li>
              ))}
            </ul>
            {can("lt_reviewer") && (v.reviewState === "in_review" || v.reviewState === "approved") && (
              <>
                <div className={s.field}>
                  <label htmlFor="rev-notes">Notes</label>
                  <textarea id="rev-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
                </div>
                {v.reviews.required.map((r) => (
                  <div key={r} className={s.btnRow} style={{ marginBottom: 6 }}>
                    <span style={{ minWidth: 110 }}>{r}</span>
                    <button className={`${s.btn} ${s.btnSmall}`} onClick={() => op({ op: "review", versionId: v.id, reviewType: r, decision: "approved", notes }, `${r} approved.`)}>
                      Approve
                    </button>
                    <button className={`${s.btnDanger} ${s.btnSmall}`} onClick={() => op({ op: "review", versionId: v.id, reviewType: r, decision: "changes_requested", notes }, `${r}: changes requested.`)}>
                      Request changes
                    </button>
                  </div>
                ))}
              </>
            )}
            <details>
              <summary>History</summary>
              <ul style={{ paddingLeft: 18 }}>
                {v.reviews.history.map((h, i) => (
                  <li key={i} className={s.muted}>
                    {fmtDateTime(h.at)} · {h.type} · {h.decision}
                    {h.notes ? ` — ${h.notes}` : ""}
                  </li>
                ))}
              </ul>
            </details>
          </section>
          {d.feedback.length > 0 && (
            <section className={s.card}>
              <h2>Parent reports</h2>
              <ul style={{ paddingLeft: 18 }}>
                {d.feedback.map((f, i) => (
                  <li key={i}>
                    <strong>{f.kind === "safety_concern" ? "Safety" : "Confusing"}</strong> · {fmtDateTime(f.at)}
                    {f.note ? `: ${f.note}` : ""}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </div>

      {valid && childView && (
        <div className={s.splitChild} style={{ marginTop: 20 }}>
          <section className={s.card}>
            <h2>Parent preview</h2>
            <ParentPreview c={valid} />
          </section>
          <section className={s.card}>
            <h2>Child device preview</h2>
            <div className={s.btnRow} style={{ marginBottom: 10 }}>
              <button className={`${s.btnGhost} ${s.btnSmall}`} onClick={() => setStepIdx(Math.max(0, stepIdx - 1))}>
                ←
              </button>
              <span>
                Step {Math.min(stepIdx, childView.steps.length - 1) + 1} / {childView.steps.length}
              </span>
              <button className={`${s.btnGhost} ${s.btnSmall}`} onClick={() => setStepIdx(Math.min(childView.steps.length - 1, stepIdx + 1))}>
                →
              </button>
            </div>
            <div className={cx(s.previewPhone)}>
              <Follower
                activity={childView}
                state="active"
                stepIndex={Math.min(stepIdx, childView.steps.length - 1)}
                readAloud={false}
                reducedMotion
                kids={[{ id: "preview", nickname: "Preview", avatarKey: "owl", ready: true, answered: [], helpPending: false }]}
                onReady={async () => undefined}
                onRespond={async () => undefined}
                onHelp={async () => undefined}
              />
            </div>
          </section>
        </div>
      )}
    </LearnShell>
  );
}

// ---------- Metrics ----------
type Cell = { value: number | null; families: number; suppressed: boolean };
const show = (c: Cell | undefined, suffix = "") => (!c ? "—" : c.suppressed ? <span className={s.suppressed}>&lt;5 families</span> : c.value === null ? "—" : `${c.value}${suffix}`);

export function Metrics({ user }: { user: unknown }) {
  const [m, setM] = useState<any>(null);
  const [days, setDays] = useState(56);
  const [err, setErr] = useState<unknown>(null);
  useEffect(() => {
    parentApi.get(`/api/learn/admin/metrics?days=${days}`).then(setM, setErr);
  }, [days]);
  return (
    <LearnShell user={user} title="Metrics" admin>
      <div className={s.pageHead}>
        <div>
          <h1>Product metrics</h1>
          <p>Aggregated only. Any figure backed by fewer than 5 families is hidden. Formulas: docs/learn-together/ANALYTICS.md.</p>
        </div>
        <div className={s.segmented}>
          {[28, 56, 90].map((d) => (
            <button key={d} aria-pressed={days === d} onClick={() => setDays(d)}>
              {d} days
            </button>
          ))}
        </div>
      </div>
      <ErrorNote error={err} />
      {!m ? (
        <Loading />
      ) : (
        <>
          <section className={s.card}>
            <h2>North star: completed sessions per active family, weekly</h2>
            <div className={s.tableWrap}>
              <table className={s.table}>
                <thead>
                  <tr>
                    <th scope="col">Week of</th>
                    <th scope="col">Per active family</th>
                  </tr>
                </thead>
                <tbody>
                  {m.northStar.map((w: Cell & { week: string }) => (
                    <tr key={w.week}>
                      <td>{w.week}</td>
                      <td>{show(w)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
          <div className={s.statRow} style={{ marginBottom: 20 }}>
            {(
              [
                ["Activation (first session ≤ 7 days)", m.activation, "%"],
                ["Session completion", m.completionRate, "%"],
                ["2nd session ≤ 14 days", m.repeatUse.second14d, "%"],
                ["3rd session ≤ 30 days", m.repeatUse.third30d, "%"],
                ["Connected-mode adoption", m.connectedAdoption, "%"],
                ["Pairing success", m.pairingSuccess, "%"],
                ["Parent confidence (1–5)", m.parentConfidence, ""],
              ] as [string, Cell, string][]
            ).map(([label, c, suf]) => (
              <div key={label} className={s.stat}>
                <strong>{show(c, suf)}</strong> {label}
              </div>
            ))}
          </div>
          <section className={s.card}>
            <h2>Sync health</h2>
            <p>
              Launch → open: p50 {show(m.syncHealth.launch.p50, " ms")}, p95 {show(m.syncHealth.launch.p95, " ms")} ({m.syncHealth.launch.samples} samples)
              <br />
              Step propagation: p50 {show(m.syncHealth.step.p50, " ms")}, p95 {show(m.syncHealth.step.p95, " ms")} ({m.syncHealth.step.samples} samples)
              <br />
              Reconnects: {show(m.syncHealth.reconnects)} · Failed launches: {show(m.syncHealth.failedLaunches)}
            </p>
          </section>
          <section className={s.card}>
            <h2>Per activity</h2>
            <div className={s.tableWrap}>
              <table className={s.table}>
                <thead>
                  <tr>
                    {["Activity", "Launched", "Completion", "Common drop-off step", "Usefulness", "Confusing", "Safety", "Kit interest"].map((h) => (
                      <th key={h} scope="col">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {m.perActivity.map((a: any) => (
                    <tr key={a.slug}>
                      <td>{a.slug}</td>
                      <td>{show(a.launched)}</td>
                      <td>{show(a.completionRate, "%")}</td>
                      <td>{a.commonDropOffStepIndex.suppressed || a.commonDropOffStepIndex.value === null ? show(a.commonDropOffStepIndex) : `step ${a.commonDropOffStepIndex.value + 1}`}</td>
                      <td>{show(a.usefulness)}</td>
                      <td>{show(a.confusionReports)}</td>
                      <td>{show(a.safetyReports)}</td>
                      <td>{show(a.kitInterest)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
          <div className="row">
            <div className="col-md-6">
              <section className={s.card}>
                <h2>Concept status movement</h2>
                <ul style={{ paddingLeft: 18 }}>
                  {m.conceptMovement.map((c: any, i: number) => (
                    <li key={i}>
                      {c.from || "new"} → {c.to}: {show(c)}
                    </li>
                  ))}
                </ul>
              </section>
            </div>
            <div className="col-md-6">
              <section className={s.card}>
                <h2>Device mix (events)</h2>
                <ul style={{ paddingLeft: 18 }}>
                  {m.deviceMix.map((c: any) => (
                    <li key={c.deviceClass}>
                      {c.deviceClass}: {show(c)}
                    </li>
                  ))}
                </ul>
              </section>
            </div>
          </div>
        </>
      )}
    </LearnShell>
  );
}
