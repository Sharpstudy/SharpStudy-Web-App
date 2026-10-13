import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/router";
import { parentApi } from "../api";
import { ErrorNote, LearnShell, Loading, s } from "../ui";
import { SUBJECT_ICON } from "../icons";
import { conceptLabel } from "../concepts";
import { useMe } from "./Home";

import { applyFilters, DEFAULT_FILTERS, type ActivitySummary, type Filters } from "./filters";
export type { ActivitySummary, Filters };

const TYPE_LABEL: Record<string, string> = { real_life_math_mission: "Real-life maths mission", science_at_home_lab: "Science at home lab" };

export function ActivityCard({ a, onToggle }: { a: ActivitySummary; onToggle?: (op: "save" | "dismiss", on: boolean) => void }) {
  return (
    <article className={s.activityCard}>
      <span className={s.subjectTag}>
        <span aria-hidden="true">{SUBJECT_ICON[a.subject]}</span> {TYPE_LABEL[a.activityType] || a.activityType}
      </span>
      <h3>{a.title}</h3>
      <p style={{ margin: 0 }}>{a.learningGoal}</p>
      <div className={s.meta}>
        <span>{a.estimatedMinutes} min</span>
        <span>Ages {a.ageBands.join(", ")}</span>
        <span>{a.materialsNeed === "none" ? "No materials" : "Household items"}</span>
        {a.lowMess && <span>Low mess</span>}
      </div>
      <div className={s.chips}>
        {a.conceptTags.map((c) => (
          <span key={c} className={s.chip}>
            {conceptLabel(c)}
          </span>
        ))}
      </div>
      {!a.entitled && <p className={s.muted}>Included in full pathways</p>}
      <div className={s.actions}>
        <Link href={`/learn/activity/${a.slug}`}>
          <a className={`${s.btn} ${s.btnSmall}`}>Preview</a>
        </Link>
        {onToggle && (
          <>
            <button className={`${s.btnGhost} ${s.btnSmall}`} aria-pressed={a.saved} onClick={() => onToggle("save", !a.saved)}>
              {a.saved ? "Saved" : "Save"}
            </button>
            <button className={`${s.btnGhost} ${s.btnSmall}`} aria-pressed={a.dismissed} onClick={() => onToggle("dismiss", !a.dismissed)}>
              {a.dismissed ? "Undo hide" : "Hide"}
            </button>
          </>
        )}
      </div>
    </article>
  );
}

export default function Explore({ user }: { user: unknown }) {
  const router = useRouter();
  const { me, error } = useMe();
  const [list, setList] = useState<ActivitySummary[] | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const [f, setF] = useState<Filters>(DEFAULT_FILTERS);

  useEffect(() => {
    if (router.query.maxMinutes === "10") setF((x) => ({ ...x, maxMinutes: 10 }));
  }, [router.query.maxMinutes]);
  useEffect(() => {
    if (me) parentApi.get<{ activities: ActivitySummary[] }>("/api/learn/activities").then((r) => setList(r.activities), setErr);
  }, [me]);

  const shown = useMemo(() => (list ? applyFilters(list, f) : []), [list, f]);
  const set = <K extends keyof Filters>(k: K, v: Filters[K]) => setF((x) => ({ ...x, [k]: v }));
  const toggle = async (a: ActivitySummary, op: "save" | "dismiss", on: boolean) => {
    try {
      if (on) await parentApi.post(`/api/learn/activities/${a.slug}/${op}`, {});
      else await parentApi.del(`/api/learn/activities/${a.slug}/${op}`);
      setList((l) => l!.map((x) => (x.slug === a.slug ? { ...x, [op === "save" ? "saved" : "dismissed"]: on } : x)));
    } catch (e) {
      setErr(e);
    }
  };

  const seg = <K extends keyof Filters>(k: K, label: string, options: [Filters[K], string][]) => (
    <fieldset key={k} style={{ marginBottom: 12 }}>
      <legend className={s.muted} style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>
        {label}
      </legend>
      <div className={s.segmented}>
        {options.map(([v, l]) => (
          <button key={String(v)} type="button" aria-pressed={f[k] === v} onClick={() => set(k, v)}>
            {l}
          </button>
        ))}
      </div>
    </fieldset>
  );

  return (
    <LearnShell user={user} title="Explore">
      <div className={s.pageHead}>
        <div>
          <h1>Explore activities</h1>
          <p>Browse freely. Every activity works with things you already have.</p>
        </div>
      </div>
      <ErrorNote error={error || err} />
      <section className={s.card} aria-label="Filters">
        <div className="row">
          <div className="col-md-6">
            {seg("subject", "Subject", [["", "All"], ["math", "Maths"], ["science", "Science"]])}
            {seg("maxMinutes", "Time", [[0, "Any"], [10, "≤ 10 min"], [15, "≤ 15 min"]])}
            {seg("activityType", "Type", [["", "All"], ["real_life_math_mission", "Maths missions"], ["science_at_home_lab", "Science labs"]])}
          </div>
          <div className="col-md-6">
            {seg("materials", "Materials", [["", "Any"], ["household", "Household items"], ["kit", "Have the kit"], ["none", "Nothing needed"]])}
            {seg("setting", "Where", [["", "Anywhere"], ["indoor", "Indoors"], ["outdoor", "Outdoors"]])}
            <div className={s.btnRow}>
              <button type="button" className={s.chipToggle} aria-pressed={f.lowMess} onClick={() => set("lowMess", !f.lowMess)}>
                Low mess
              </button>
              <button type="button" className={s.chipToggle} aria-pressed={f.savedOnly} onClick={() => set("savedOnly", !f.savedOnly)}>
                Saved only
              </button>
              <button type="button" className={s.chipToggle} aria-pressed={f.showDismissed} onClick={() => set("showDismissed", !f.showDismissed)}>
                Show hidden
              </button>
            </div>
          </div>
        </div>
      </section>
      {!list ? (
        <Loading />
      ) : (
        <>
          <p className={s.muted} role="status" aria-live="polite">
            {shown.length} {shown.length === 1 ? "activity" : "activities"}
          </p>
          <div className={s.grid}>
            {shown.map((a) => (
              <ActivityCard key={a.slug} a={a} onToggle={(op, on) => toggle(a, op, on)} />
            ))}
          </div>
          {!shown.length && (
            <p className={s.muted}>
              Nothing matches those filters.{" "}
              <button className={`${s.btnGhost} ${s.btnSmall}`} onClick={() => setF(DEFAULT_FILTERS)}>
                Clear filters
              </button>
            </p>
          )}
        </>
      )}
    </LearnShell>
  );
}
