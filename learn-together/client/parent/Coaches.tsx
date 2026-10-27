import React, { useEffect, useState } from "react";
import { parentApi } from "../api";
import { ErrorNote, LearnShell, Loading, s } from "../ui";

interface Coach {
  id: string;
  userId: string;
  firstName: string;
  lastName: string;
  bio: string | null;
  subjects: string[];
  hourlyRateCents: number;
  rating: number | null;
  reviewCount: number;
}

// Demo coaches shown when DB is empty
const DEMO_COACHES: Coach[] = [
  { id: "demo-1", userId: "", firstName: "Athena", lastName: "Okafor", bio: "Former classroom teacher with 8 years' experience in primary math and language arts.", subjects: ["Math", "Reading"], hourlyRateCents: 5500, rating: 4.9, reviewCount: 47 },
  { id: "demo-2", userId: "", firstName: "Hannah", lastName: "Kim", bio: "Specialises in teaching children with different learning styles using hands-on methods.", subjects: ["Science", "Math"], hourlyRateCents: 4500, rating: 4.7, reviewCount: 31 },
  { id: "demo-3", userId: "", firstName: "Luna", lastName: "Morales", bio: "Bilingual educator (English/Spanish) focusing on reading fluency and creative writing.", subjects: ["Reading", "Writing"], hourlyRateCents: 4000, rating: 4.8, reviewCount: 22 },
];

type Tab = "browse" | "upcoming";

function Stars({ rating }: { rating: number | null }) {
  if (!rating) return null;
  const full = Math.round(rating);
  return (
    <span className={s.coachStars} title={`${rating}/5`}>
      {"★".repeat(full)}{"☆".repeat(5 - full)} {rating.toFixed(1)}
    </span>
  );
}

export default function Coaches({ user }: { user: unknown }) {
  const [tab, setTab] = useState<Tab>("browse");
  const [coaches, setCoaches] = useState<Coach[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  const [selected, setSelected] = useState<Coach | null>(null);
  const [scheduledAt, setScheduledAt] = useState("");
  const [duration, setDuration] = useState(60);
  const [notes, setNotes] = useState("");
  const [booking, setBooking] = useState(false);
  const [booked, setBooked] = useState(false);

  useEffect(() => {
    setLoading(true);
    parentApi
      .get<Coach[]>("/api/learn/coaches")
      .then((data) => setCoaches(data.length ? data : DEMO_COACHES))
      .catch(() => setCoaches(DEMO_COACHES))
      .finally(() => setLoading(false));
  }, []);

  const book = async () => {
    if (!selected || !scheduledAt) return;
    setBooking(true);
    try {
      await parentApi.post("/api/learn/coaches/book", {
        coachId: selected.id,
        scheduledAt: new Date(scheduledAt).toISOString(),
        durationMinutes: duration,
        notes: notes || undefined,
      });
      setBooked(true);
      setTab("upcoming");
    } catch (e) {
      setErr(e);
    } finally {
      setBooking(false);
    }
  };

  const fmtRate = (cents: number) => `$${(cents / 100).toFixed(0)}/hr`;

  return (
    <LearnShell user={user} title="Coaches">
      <div className={s.coachesHeader}>
        <h1>Coaches who coach you, not just your child</h1>
        <p>Our advisors guide the parent-teacher, so every lesson you give is better.</p>
      </div>

      <ErrorNote error={err} />

      <div className={s.coachesTabs}>
        <button className={tab === "browse" ? s.active : ""} onClick={() => setTab("browse")}>Browse</button>
        <button className={tab === "upcoming" ? s.active : ""} onClick={() => setTab("upcoming")}>Upcoming</button>
      </div>

      {tab === "browse" && (
        <div className={s.coachesLayout}>
          <div>
            {loading ? <Loading /> : coaches.map((c) => (
              <div key={c.id} className={s.coachCard}>
                <div className={s.coachAvatar}>{c.firstName[0]}{c.lastName[0]}</div>
                <div className={s.coachInfo}>
                  <h3>{c.firstName} {c.lastName}</h3>
                  <Stars rating={c.rating} />
                  <p>{c.subjects.join(", ")} · {fmtRate(c.hourlyRateCents)}</p>
                  {c.bio && <p>{c.bio}</p>}
                </div>
                <div>
                  <button
                    className={`${s.btn} ${s.btnSmall}`}
                    onClick={() => { setSelected(c); setBooked(false); }}
                  >
                    Book
                  </button>
                </div>
              </div>
            ))}
          </div>

          <div className={s.bookPanel}>
            <h3>Book Advisor</h3>
            {!selected ? (
              <p className={s.muted} style={{ fontSize: 14 }}>Select a coach to book a session.</p>
            ) : (
              <>
                <p style={{ fontSize: 14, marginBottom: 14 }}>
                  Booking with <strong>{selected.firstName} {selected.lastName}</strong>
                </p>
                {booked ? (
                  <p style={{ color: "#1e7b4f", fontWeight: 600 }}>✓ Session requested! You'll receive a confirmation.</p>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                    <div className={s.field}>
                      <label htmlFor="sched-at">Date & time</label>
                      <input
                        id="sched-at"
                        type="datetime-local"
                        value={scheduledAt}
                        min={new Date().toISOString().slice(0, 16)}
                        onChange={(e) => setScheduledAt(e.target.value)}
                      />
                    </div>
                    <div className={s.field}>
                      <label htmlFor="duration">Duration</label>
                      <select id="duration" value={duration} onChange={(e) => setDuration(Number(e.target.value))}>
                        <option value={30}>30 minutes</option>
                        <option value={60}>60 minutes</option>
                        <option value={90}>90 minutes</option>
                      </select>
                    </div>
                    <div className={s.field}>
                      <label htmlFor="notes">Notes (optional)</label>
                      <textarea id="notes" rows={3} maxLength={500} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="What would you like to focus on?" />
                    </div>
                    <button className={s.btn} onClick={book} disabled={booking || !scheduledAt}>
                      {booking ? "Booking…" : "Confirm booking"}
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {tab === "upcoming" && (
        <div>
          {booked ? (
            <div className={`${s.card}`}>
              <p style={{ fontWeight: 600 }}>✓ New session requested with {selected?.firstName} {selected?.lastName}</p>
              <p className={s.muted} style={{ fontSize: 14 }}>Awaiting confirmation from the coach.</p>
            </div>
          ) : (
            <p className={s.muted}>No upcoming sessions yet. Browse coaches and book your first session.</p>
          )}
        </div>
      )}
    </LearnShell>
  );
}
