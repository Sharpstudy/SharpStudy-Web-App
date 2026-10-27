import React, { useEffect, useState } from "react";
import { kidApi } from "../api";
import { ErrorNote, Loading, s } from "../ui";
import { KidHead } from "./Kid";

interface Reflection {
  id: string;
  text: string;
  mood: "great" | "good" | "okay" | "hard";
  createdAt: string;
}

const MOOD_EMOJI: Record<string, string> = { great: "😄", good: "🙂", okay: "😐", hard: "😟" };
const MOOD_LABEL: Record<string, string> = { great: "Great!", good: "Good", okay: "Okay", hard: "Hard" };

export default function Reflections() {
  const [reflections, setReflections] = useState<Reflection[]>([]);
  const [childId, setChildId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<unknown>(null);
  const [text, setText] = useState("");
  const [mood, setMood] = useState<"great" | "good" | "okay" | "hard">("good");
  const [saving, setSaving] = useState(false);
  const [showForm, setShowForm] = useState(false);

  useEffect(() => {
    kidApi.get<any>("/api/learn/kid/me").then((me) => {
      const id = me.activeChildId || me.children[0]?.id;
      setChildId(id || null);
      if (id) return kidApi.get<Reflection[]>(`/api/learn/kid/reflections?childProfileId=${id}`);
      return [];
    }).then((data: any) => {
      setReflections(Array.isArray(data) ? data : []);
    }).catch(setErr).finally(() => setLoading(false));
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!childId || !text.trim()) return;
    setSaving(true);
    try {
      const r = await kidApi.post<Reflection>("/api/learn/kid/reflections", { childProfileId: childId, text: text.trim(), mood });
      setReflections((prev) => [r, ...prev]);
      setText("");
      setShowForm(false);
    } catch (e2) {
      setErr(e2);
    } finally {
      setSaving(false);
    }
  };

  const fmt = (d: string) => new Date(d).toLocaleDateString(undefined, { month: "short", day: "numeric" });

  return (
    <div className={s.kid} id="lt-kid">
      <KidHead title="My Reflections" />
      <div className={s.kidTop}>
        <span style={{ fontSize: 18, fontWeight: 700 }}>📓 My Reflections</span>
        <a href="/learn/kid" className={s.grownUpBtn}>← Back</a>
      </div>
      <main className={s.kidMain} style={{ padding: "20px 16px", alignItems: "stretch", overflowY: "auto", maxWidth: 480, width: "100%" }}>
        <ErrorNote error={err} />

        {!showForm ? (
          <button className={s.btn} style={{ marginBottom: 20 }} onClick={() => setShowForm(true)}>
            + Add reflection
          </button>
        ) : (
          <form className={s.card} onSubmit={submit} style={{ marginBottom: 20 }}>
            <h3 style={{ marginBottom: 12 }}>How did today feel?</h3>
            <div className={s.moodPicker}>
              {(["great", "good", "okay", "hard"] as const).map((m) => (
                <button type="button" key={m} className={mood === m ? s.selected : ""} onClick={() => setMood(m)}>
                  {MOOD_EMOJI[m]}
                </button>
              ))}
            </div>
            <div className={s.field}>
              <label htmlFor="reflect-text">Write something…</label>
              <textarea
                id="reflect-text"
                rows={3}
                maxLength={500}
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="What did you learn? What was tricky? What was fun?"
                required
              />
            </div>
            <div className={s.btnRow}>
              <button className={s.btn} disabled={saving}>{saving ? "Saving…" : "Save"}</button>
              <button type="button" className={s.btnGhost} onClick={() => setShowForm(false)}>Cancel</button>
            </div>
          </form>
        )}

        {loading ? <Loading /> : reflections.length === 0 ? (
          <p className={s.muted}>No reflections yet. Add your first one!</p>
        ) : reflections.map((r) => (
          <div key={r.id} className={s.reflectionItem}>
            <span className={s.moodEmoji} title={MOOD_LABEL[r.mood]}>{MOOD_EMOJI[r.mood]}</span>
            <div className={s.reflectionText}>
              <p style={{ margin: 0, fontSize: 15 }}>{r.text}</p>
              <p className={`${s.muted} ${s.reflectionDate}`}>{fmt(r.createdAt)} · {MOOD_LABEL[r.mood]}</p>
            </div>
          </div>
        ))}
      </main>
    </div>
  );
}
