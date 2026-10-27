import React, { useCallback, useEffect, useState } from "react";
import { parentApi } from "../api";
import { ErrorNote, LearnShell, Loading, s } from "../ui";
import { useMe } from "./Home";

const SUBJECTS = ["Math", "Reading", "Science", "History", "Writing", "Language"];
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri"];
const DAY_INDICES = [1, 2, 3, 4, 5];

interface PlanItem {
  id: string;
  subject: string;
  dayOfWeek: number;
  lessonSlug: string | null;
  position: number;
  completedAt: string | null;
}

interface EditItem {
  subject: string;
  dayOfWeek: number;
  lessonSlug: string;
}

function getMonday(d: Date) {
  const date = new Date(d);
  const day = date.getDay();
  const diff = date.getDate() - day + (day === 0 ? -6 : 1);
  date.setDate(diff);
  return date;
}

function fmtDateISO(d: Date) {
  return d.toISOString().slice(0, 10);
}

function fmtWeekLabel(monday: Date) {
  const friday = new Date(monday);
  friday.setDate(monday.getDate() + 4);
  const opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };
  return `${monday.toLocaleDateString(undefined, opts)} – ${friday.toLocaleDateString(undefined, opts)}`;
}

export default function Week({ user }: { user: unknown }) {
  const { me, error: meError } = useMe();
  const [weekOffset, setWeekOffset] = useState(0);
  const [plan, setPlan] = useState<PlanItem[]>([]);
  const [edits, setEdits] = useState<EditItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  const [saved, setSaved] = useState(false);

  const activeChild = me?.children[0];
  const monday = getMonday(new Date());
  monday.setDate(monday.getDate() + weekOffset * 7);
  const weekStart = fmtDateISO(monday);

  const load = useCallback(async () => {
    if (!activeChild) return;
    setLoading(true);
    try {
      const items = await parentApi.get<PlanItem[]>(
        `/api/learn/week?childProfileId=${activeChild.id}&weekStart=${weekStart}`
      );
      setPlan(items);
      setEdits(
        items.map((i) => ({ subject: i.subject, dayOfWeek: i.dayOfWeek, lessonSlug: i.lessonSlug || "" }))
      );
    } catch (e) {
      setErr(e);
    } finally {
      setLoading(false);
    }
  }, [activeChild, weekStart]);

  useEffect(() => {
    if (me) void load();
  }, [me, load]);

  const setCell = (subject: string, dayOfWeek: number, lessonSlug: string) => {
    setEdits((prev) => {
      const next = prev.filter((e) => !(e.subject === subject && e.dayOfWeek === dayOfWeek));
      if (lessonSlug) next.push({ subject, dayOfWeek, lessonSlug });
      return next;
    });
    setSaved(false);
  };

  const getCell = (subject: string, dayOfWeek: number) =>
    edits.find((e) => e.subject === subject && e.dayOfWeek === dayOfWeek)?.lessonSlug || "";

  const save = async () => {
    if (!activeChild) return;
    setSaving(true);
    setSaved(false);
    try {
      await parentApi.post("/api/learn/week", {
        childProfileId: activeChild.id,
        weekStart,
        items: edits.filter((e) => e.lessonSlug).map((e, i) => ({ ...e, position: i })),
      });
      setSaved(true);
      void load();
    } catch (e) {
      setErr(e);
    } finally {
      setSaving(false);
    }
  };

  const totalSlots = edits.filter((e) => e.lessonSlug).length;

  if (!me) return <LearnShell user={user} title="Week">{meError ? <ErrorNote error={meError} /> : <Loading />}</LearnShell>;

  return (
    <LearnShell user={user} title="Week">
      <ErrorNote error={err} />

      <div className={s.weekHeader}>
        <button className={`${s.btnGhost} ${s.btnSmall}`} onClick={() => setWeekOffset((o) => o - 1)}>‹ Prev</button>
        <h1>{fmtWeekLabel(monday)}</h1>
        <button className={`${s.btnGhost} ${s.btnSmall}`} onClick={() => setWeekOffset((o) => o + 1)}>Next ›</button>
      </div>

      {activeChild && (
        <p className={s.muted} style={{ marginBottom: 16 }}>
          Planning for <strong>{activeChild.nickname}</strong>
          {me.children.length > 1 && " · Switch child from the family page"}
        </p>
      )}

      {loading ? <Loading /> : (
        <div className={s.weekLayout}>
          <div>
            <div className={s.weekGrid}>
              <table className={s.weekTable}>
                <thead>
                  <tr>
                    <th>Subject</th>
                    {DAYS.map((d) => <th key={d}>{d}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {SUBJECTS.map((subject) => (
                    <tr key={subject}>
                      <td><strong>{subject}</strong></td>
                      {DAY_INDICES.map((day) => {
                        const val = getCell(subject, day);
                        return (
                          <td key={day}>
                            <input
                              type="text"
                              value={val}
                              placeholder="Add lesson..."
                              onChange={(e) => setCell(subject, day, e.target.value)}
                              style={{
                                width: "100%",
                                border: "none",
                                background: val ? "#e8f2fc" : "transparent",
                                borderRadius: 4,
                                padding: "4px 6px",
                                fontSize: 13,
                                fontFamily: "inherit",
                                color: val ? "#1d5287" : "#999",
                                minHeight: 32,
                                outline: "none",
                              }}
                            />
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className={s.weekSidebar}>
            <h3>Suggestions</h3>
            <p className={s.muted} style={{ fontSize: 13 }}>
              Aim for 30 min · 5 days to stay on track.
            </p>
            <p style={{ fontSize: 13, marginBottom: 16 }}>
              <strong>{totalSlots}</strong> slot{totalSlots !== 1 ? "s" : ""} planned this week.
            </p>
            <div className={s.sparkCard} style={{ marginBottom: 16 }}>
              <h3 style={{ fontSize: 14 }}>💡 Tip</h3>
              <p style={{ fontSize: 13 }}>Try to schedule at least one activity per subject each week for steady progress.</p>
            </div>
            {saved && <p style={{ color: "#1e7b4f", fontSize: 14, marginBottom: 12 }}>✓ Plan saved</p>}
            <button className={s.btn} onClick={save} disabled={saving} style={{ width: "100%" }}>
              {saving ? "Saving…" : "Confirm all ›"}
            </button>
          </div>
        </div>
      )}
    </LearnShell>
  );
}
