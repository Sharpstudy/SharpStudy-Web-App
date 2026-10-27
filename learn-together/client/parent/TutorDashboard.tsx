import React, { useEffect, useState } from "react";
import { parentApi } from "../api";
import { ErrorNote, LearnShell, Loading, fmtDateTime, s } from "../ui";

interface TutorSession {
  id: string;
  coachId: string;
  familyId: string;
  scheduledAt: string;
  durationMinutes: number;
  status: string;
  notes: string | null;
}

const TOOLS = [
  { icon: "🗣️", title: "Phrase & vocabulary", body: "Build topic-specific vocabulary with guided conversation prompts." },
  { icon: "🔢", title: "Number sense", body: "Visual and tactile strategies to strengthen numerical understanding." },
  { icon: "📖", title: "Language comprehension", body: "Listening and reading comprehension activities adapted to level." },
];

export default function TutorDashboard({ user }: { user: unknown }) {
  const [sessions, setSessions] = useState<TutorSession[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  const [selected, setSelected] = useState<TutorSession | null>(null);
  const today = new Date().toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });

  useEffect(() => {
    setLoading(true);
    parentApi
      .get<TutorSession[]>("/api/learn/tutor/sessions")
      .then((data) => {
        setSessions(data);
        if (data.length) setSelected(data[0]);
      })
      .catch(setErr)
      .finally(() => setLoading(false));
  }, []);

  return (
    <LearnShell user={user} title="Tutor Dashboard">
      <div className={s.pageHead}>
        <div>
          <h1>Tutor Dashboard</h1>
          <p>Today, {today}</p>
        </div>
      </div>

      <ErrorNote error={err} />

      {loading ? <Loading /> : (
        <div className={s.tutorLayout}>
          <div className={s.tutorSidebar}>
            <h3>Your sessions</h3>
            {sessions.length === 0 ? (
              <p className={s.muted} style={{ padding: 16, fontSize: 14 }}>No upcoming sessions.</p>
            ) : sessions.map((sess) => (
              <div
                key={sess.id}
                className={`${s.tutorSession}${selected?.id === sess.id ? ` ${s.selected}` : ""}`}
                onClick={() => setSelected(sess)}
              >
                <strong>{fmtDateTime(sess.scheduledAt)}</strong>
                <span>{sess.durationMinutes} min · {sess.status}</span>
                {sess.notes && <span style={{ display: "block", fontSize: 12, marginTop: 2, color: "#666" }}>{sess.notes.slice(0, 40)}…</span>}
              </div>
            ))}
          </div>

          <div>
            {selected ? (
              <>
                <div className={`${s.card}`} style={{ marginBottom: 16 }}>
                  <h2>Session {fmtDateTime(selected.scheduledAt)}</h2>
                  <p className={s.muted}>{selected.durationMinutes} minutes · Status: <strong>{selected.status}</strong></p>
                  {selected.notes && <p>{selected.notes}</p>}
                </div>

                <h3 style={{ fontWeight: 700, marginBottom: 12 }}>Teaching tools</h3>
                <div className={s.toolCards}>
                  {TOOLS.map((t) => (
                    <div key={t.title} className={s.toolCard}>
                      <div style={{ fontSize: 28, marginBottom: 8 }}>{t.icon}</div>
                      <h4>{t.title}</h4>
                      <p>{t.body}</p>
                    </div>
                  ))}
                </div>

                <div className={`${s.card}`}>
                  <h3>Bill for session</h3>
                  <p className={s.muted}>Submit payment request for this session after it's completed.</p>
                  <div style={{ display: "flex", gap: 12, alignItems: "center", marginTop: 12 }}>
                    <div className={s.field} style={{ margin: 0, flex: "0 0 140px" }}>
                      <label htmlFor="bill-amt">Amount ($)</label>
                      <input id="bill-amt" type="number" min="0" step="0.01" placeholder="0.00" />
                    </div>
                    <button className={`${s.btn} ${s.btnSmall}`} style={{ alignSelf: "flex-end" }}>
                      Send invoice
                    </button>
                  </div>
                </div>
              </>
            ) : (
              <p className={s.muted} style={{ padding: "40px 0", textAlign: "center" }}>
                No session selected. Your upcoming sessions appear in the sidebar once families book with you.
              </p>
            )}
          </div>
        </div>
      )}
    </LearnShell>
  );
}
