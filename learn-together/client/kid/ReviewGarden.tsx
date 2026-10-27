import React, { useEffect, useState } from "react";
import { kidApi } from "../api";
import { ErrorNote, Loading, s } from "../ui";
import { KidHead } from "./Kid";
import { conceptLabel } from "../concepts";

interface ReviewItem {
  id: string;
  childProfileId: string;
  conceptTag: string;
  activitySlug: string | null;
  nextReviewAt: string;
}

interface KidMe {
  activeChildId: string | null;
  children: { id: string; nickname: string; avatarKey: string }[];
}

export default function ReviewGarden() {
  const [items, setItems] = useState<ReviewItem[]>([]);
  const [current, setCurrent] = useState(0);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<unknown>(null);
  const [done, setDone] = useState(false);
  const [childId, setChildId] = useState<string | null>(null);

  useEffect(() => {
    kidApi.get<KidMe>("/api/learn/kid/me").then((me) => {
      const id = me.activeChildId || me.children[0]?.id;
      setChildId(id || null);
      if (id) {
        return kidApi.get<ReviewItem[]>(`/api/learn/kid/review-garden?childProfileId=${id}`);
      }
      return [];
    }).then((data) => {
      setItems(Array.isArray(data) ? data : []);
    }).catch(setErr).finally(() => setLoading(false));
  }, []);

  const review = async (outcome: "easy" | "okay" | "hard") => {
    const item = items[current];
    if (!item) return;
    try {
      await kidApi.post("/api/learn/kid/review-garden", { itemId: item.id, outcome });
    } catch {
      // Continue even if recording fails
    }
    if (current + 1 >= items.length) {
      setDone(true);
    } else {
      setCurrent((c) => c + 1);
    }
  };

  return (
    <div className={s.kid} id="lt-kid">
      <KidHead title="Review Garden" />
      <div className={s.kidTop}>
        <span style={{ fontSize: 18, fontWeight: 700 }}>🌱 Review Garden</span>
        <a href="/learn/kid" className={s.grownUpBtn}>← Back</a>
      </div>
      <main className={s.kidMain}>
        <ErrorNote error={err} />
        {loading ? <Loading /> : done || items.length === 0 ? (
          <div className={s.reviewCard} style={{ marginTop: 40 }}>
            <div style={{ fontSize: 64 }}>🎉</div>
            <h2>{items.length === 0 ? "Nothing to review yet!" : "All done for today!"}</h2>
            <p>{items.length === 0 ? "Complete some activities and come back to review them." : "Great job reviewing today. Come back tomorrow for more."}</p>
            <a href="/learn/kid" className={s.btn}>Back to home</a>
          </div>
        ) : (
          <div className={s.reviewCard} style={{ marginTop: 40 }}>
            <p className={s.muted} style={{ fontSize: 13 }}>{current + 1} of {items.length}</p>
            <h2>{conceptLabel(items[current].conceptTag)}</h2>
            <p>How well do you remember this?</p>
            <div className={s.reviewBtns}>
              <button className={s.btnDanger} onClick={() => review("hard")}>Still hard 😬</button>
              <button className={s.btnGhost} onClick={() => review("okay")}>Getting there 🙂</button>
              <button className={s.btn} onClick={() => review("easy")}>Got it! 🌟</button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
