import React, { useEffect, useState } from "react";
import { useRouter } from "next/router";
import { download, parentApi } from "../api";
import { ErrorNote, LearnShell, Loading, s, useReauth } from "../ui";
import { PrivacyExplainer } from "./Onboarding";
import { useMe } from "./Home";

export default function Privacy({ user }: { user: unknown }) {
  const router = useRouter();
  const { me, error } = useMe();
  const [err, setErr] = useState<unknown>(null);
  const reauth = useReauth();
  if (!me) return <LearnShell user={user} title="Privacy">{error ? <ErrorNote error={error} /> : <Loading />}</LearnShell>;
  return (
    <LearnShell user={user} title="Privacy">
      {reauth.dialog}
      <div className={s.pageHead}>
        <div>
          <h1>Privacy and your data</h1>
          <p>What Learn Together keeps, and how to take it with you or delete it.</p>
        </div>
      </div>
      <ErrorNote error={err} />
      <section className={s.card}>
        <h2>What we keep</h2>
        <PrivacyExplainer />
        <p className={s.muted}>Each child&apos;s data can also be exported or deleted from their Progress and Family pages.</p>
      </section>
      <section className={s.card}>
        <h2>Download everything</h2>
        <p>A JSON file with your family, children, sessions, answers, reflections and devices.</p>
        <button className={s.btn} onClick={() => download("/api/learn/privacy/export", "learn-together-family.json").catch(setErr)}>
          Download family data
        </button>
      </section>
      {me.user.familyRole === "owner" && (
        <section className={s.card} style={{ borderColor: "#f2b8b5" }}>
          <h2>Delete all Learn Together data</h2>
          <p>Removes every child profile, session, answer, reflection and paired device for your family. Your Sharp Study account itself is not affected. This can&apos;t be undone.</p>
          <button
            className={s.btnDanger}
            onClick={async () => {
              if (!window.confirm("Delete all of your family's Learn Together data? This can't be undone.")) return;
              const token = await reauth.ask();
              if (!token) return;
              try {
                await parentApi.post("/api/learn/privacy/delete", {}, token);
                router.push("/learn/onboarding");
              } catch (e) {
                setErr(e);
              }
            }}
          >
            Delete everything
          </button>
        </section>
      )}
    </LearnShell>
  );
}

export function InvitePage({ user }: { user: unknown }) {
  const router = useRouter();
  const [state, setState] = useState<"working" | "done" | "error">("working");
  const [err, setErr] = useState<unknown>(null);
  useEffect(() => {
    const token = String(router.query.token || "");
    if (!token) return;
    parentApi.post("/api/learn/caregivers/accept", { token }).then(
      () => setState("done"),
      (e) => {
        setErr(e);
        setState("error");
      }
    );
  }, [router.query.token]);
  return (
    <LearnShell user={user} title="Join a family">
      <section className={s.card}>
        <h1 style={{ fontSize: 26 }}>Join a Learn Together family</h1>
        {state === "working" && <Loading label="Accepting invite…" />}
        {state === "error" && <ErrorNote error={err} />}
        {state === "done" && (
          <>
            <p>You&apos;re in. You can now run activities and see progress for this family&apos;s children.</p>
            <button className={s.btn} onClick={() => router.push("/learn")}>
              Go to Learn Together
            </button>
          </>
        )}
      </section>
    </LearnShell>
  );
}
