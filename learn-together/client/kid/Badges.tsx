import React, { useEffect, useState } from "react";
import { kidApi } from "../api";
import { ErrorNote, Loading, s } from "../ui";
import { KidHead } from "./Kid";

interface Badge {
  id: string;
  badgeKey: string;
  childProfileId: string | null;
  earnedAt: string;
}

const ALL_BADGES = [
  { key: "first_lesson", label: "First Lesson", emoji: "⭐" },
  { key: "week_streak", label: "Week Streak", emoji: "🔥" },
  { key: "math_explorer", label: "Math Explorer", emoji: "🔢" },
  { key: "reader", label: "Bookworm", emoji: "📚" },
  { key: "scientist", label: "Scientist", emoji: "🔬" },
  { key: "five_lessons", label: "5 Lessons", emoji: "🎯" },
  { key: "family_time", label: "Family Time", emoji: "❤️" },
  { key: "helper", label: "Helper", emoji: "🤝" },
  { key: "curious", label: "Curious Mind", emoji: "🧠" },
  { key: "brave", label: "Brave Learner", emoji: "🦁" },
  { key: "creative", label: "Creative", emoji: "🎨" },
  { key: "kind", label: "Kindness Star", emoji: "🌟" },
];

export default function Badges() {
  const [earned, setEarned] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<unknown>(null);

  useEffect(() => {
    kidApi.get<Badge[]>("/api/learn/kid/badges")
      .then((data) => setEarned(new Set((data || []).map((b) => b.badgeKey))))
      .catch(setErr)
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className={s.kid} id="lt-kid">
      <KidHead title="Family Badges" />
      <div className={s.kidTop}>
        <span style={{ fontSize: 18, fontWeight: 700 }}>🏅 Family Badges</span>
        <a href="/learn/kid" className={s.grownUpBtn}>← Back</a>
      </div>
      <main className={s.kidMain} style={{ padding: "20px 16px", alignItems: "flex-start", overflowY: "auto" }}>
        <ErrorNote error={err} />
        {loading ? <Loading /> : (
          <>
            <p className={s.muted} style={{ marginBottom: 20 }}>
              {earned.size} of {ALL_BADGES.length} badges earned
            </p>
            <div className={s.badgeGrid}>
              {ALL_BADGES.map((b) => (
                <div key={b.key} className={`${s.badge}${earned.has(b.key) ? ` ${s.earned}` : ""}`}>
                  <div className={s.badgeCircle} style={!earned.has(b.key) ? { filter: "grayscale(1)", opacity: 0.4 } : {}}>
                    {b.emoji}
                  </div>
                  <span className={s.badgeLabel}>{b.label}</span>
                </div>
              ))}
            </div>
          </>
        )}
      </main>
    </div>
  );
}
