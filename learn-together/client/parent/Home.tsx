import React, { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/router";
import { parentApi } from "../api";
import { useLiveState } from "../realtime";
import { t } from "../i18n";
import { Avatar, ErrorNote, LearnShell, Loading, Status, s } from "../ui";
import { ApprovalPrompt, type Child, type PendingApproval } from "./family-parts";
import { channels } from "@/learn-together/domain/sync";
import type { Recommendation } from "@/learn-together/domain/recommend";

export interface Me {
  user: { firstName: string; ltRoles: string[]; familyRole: "owner" | "caregiver" | null };
  realtime: boolean;
  family: { id: string; name: string; hasPin: boolean } | null;
  children: Child[];
  members: { userId: string; role: string; firstName: string; email: string; isYou: boolean }[];
  invites: { id: string; email: string; expiresAt: string }[];
}

interface HomeState {
  family: Me["family"];
  children: (Child & { deviceStatus: "online" | "offline" | "not_paired"; recommendation: Recommendation | null })[];
  openGroups: { groupId: string; state: string; title: string; currentStepIndex: number; stepCount: number; childProfileIds: string[] }[];
  pendingApprovals: PendingApproval[];
}

// Pre-selects a child in the launch dialog without putting any child id in the URL.
export function rememberPreselect(childId: string) {
  try {
    sessionStorage.setItem("lt_preselect", childId);
  } catch {
    /* storage unavailable */
  }
}
export function takePreselect(): string | null {
  try {
    const v = sessionStorage.getItem("lt_preselect");
    sessionStorage.removeItem("lt_preselect");
    return v;
  } catch {
    return null;
  }
}

/** Loads /api/learn/me and sends parents without a family to onboarding. */
export function useMe(redirectIfNoFamily = true) {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => {
    parentApi.get<Me>("/api/learn/me").then(
      (m) => {
        if (redirectIfNoFamily && (!m.family || !m.children.length || !m.family.hasPin)) router.replace("/learn/onboarding");
        else setMe(m);
      },
      setError
    );
  }, [redirectIfNoFamily, router]);
  return { me, error, setMe };
}

export default function Home({ user }: { user: unknown }) {
  const { me, error } = useMe();
  const live = useLiveState<HomeState>({
    enabled: !!me,
    fetchState: () => parentApi.get<HomeState>("/api/learn/home"),
    seqOf: () => 0,
    channels: me?.family ? [channels.family(me.family.id)] : [],
    realtime: !!me?.realtime,
    getToken: () => parentApi.get("/api/learn/realtime/token"),
    pollMs: 4000,
  });
  const home = live.state;
  const firstRec = home?.children.find((c) => c.recommendation)?.recommendation;

  return (
    <LearnShell user={user} title="Home">
      <ErrorNote error={error || live.error} />
      {!home ? (
        <Loading />
      ) : (
        <>
          {home.pendingApprovals.map((p) => (
            <ApprovalPrompt key={p.requestId} request={p} onResolved={live.refresh} />
          ))}

          <section className={s.hero} aria-labelledby="lt-hero">
            <h1 id="lt-hero" style={{ fontSize: 30, marginBottom: 8 }}>
              Learn together, {me?.user.firstName}
            </h1>
            <p style={{ maxWidth: 560 }}>Short, practical activities you guide and your child explores. No prep beyond things you already have at home.</p>
            <Link href={firstRec ? `/learn/activity/${firstRec.slug}${firstRec.durationMode === "short" ? "?short=1" : ""}` : "/learn/explore?maxMinutes=10"}>
              <a className={s.btn}>{t("home.cta")}</a>
            </Link>
          </section>

          {home.openGroups.length > 0 && (
            <section className={s.card} aria-labelledby="lt-resume">
              <h2 id="lt-resume">In progress</h2>
              {home.openGroups.map((g) => (
                <div key={g.groupId} className={s.btnRow} style={{ justifyContent: "space-between", marginBottom: 8 }}>
                  <span>
                    <strong>{g.title}</strong>{" "}
                    <span className={s.muted}>
                      · {g.childProfileIds.map((id) => home.children.find((c) => c.id === id)?.nickname).filter(Boolean).join(", ")} · step {g.currentStepIndex + 1} of {g.stepCount}
                    </span>
                  </span>
                  <Link href={`/learn/session/${g.groupId}`}>
                    <a className={`${s.btn} ${s.btnSmall}`} onClick={() => parentApi.post("/api/learn/analytics", { name: "lt_session_resumed", props: { groupId: g.groupId } }).catch(() => undefined)}>
                      {t("home.resume")}
                    </a>
                  </Link>
                </div>
              ))}
            </section>
          )}

          <div className={s.grid}>
            {home.children.map((c) => (
              <section key={c.id} className={s.card} aria-label={c.nickname} style={{ margin: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
                  <Avatar avatarKey={c.avatarKey} />
                  <div>
                    <h2 style={{ margin: 0 }}>{c.nickname}</h2>
                    <Status online={c.deviceStatus === "online"} label={t(`device.${c.deviceStatus}` as never)} />
                  </div>
                </div>
                {c.recommendation ? (
                  <>
                    <p className={s.muted} style={{ marginBottom: 4 }}>
                      {t("home.next", { name: c.nickname })}
                    </p>
                    <p style={{ marginBottom: 4 }}>
                      <strong>{c.recommendation.title}</strong>
                    </p>
                    <p className={s.muted}>{c.recommendation.reason}</p>
                  </>
                ) : (
                  <p className={s.muted}>No published activities match yet. Explore what&apos;s available.</p>
                )}
                <div className={s.btnRow}>
                  {c.recommendation && (
                    <Link href={`/learn/activity/${c.recommendation.slug}${c.recommendation.durationMode === "short" ? "?short=1" : ""}`}>
                      <a
                        className={`${s.btn} ${s.btnSmall}`}
                        onClick={() => {
                          rememberPreselect(c.id);
                          parentApi.post("/api/learn/analytics", { name: "lt_recommendation_followed", props: { kind: c.recommendation!.kind } }).catch(() => undefined);
                        }}
                      >
                        Start
                      </a>
                    </Link>
                  )}
                  <Link href={`/learn/progress/${c.id}`}>
                    <a className={`${s.btnGhost} ${s.btnSmall}`}>Progress</a>
                  </Link>
                </div>
              </section>
            ))}
          </div>
          <p className={s.muted} style={{ marginTop: 20 }}>
            {live.status === "live" ? "Live updates on." : "Updates every few seconds."}{" "}
            <Link href="/learn/family">
              <a>Manage children and devices</a>
            </Link>
            {me && me.user.ltRoles.length > 0 && (
              <>
                {" · "}
                <Link href="/learn/admin">
                  <a>{t("nav.admin")}</a>
                </Link>
              </>
            )}
          </p>
        </>
      )}
    </LearnShell>
  );
}
