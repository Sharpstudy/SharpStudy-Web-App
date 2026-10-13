import React, { useEffect, useState } from "react";
import { useRouter } from "next/router";
import { parentApi } from "../api";
import { Avatar, ErrorNote, LearnShell, Loading, s } from "../ui";
import { ChildForm, type Child } from "./family-parts";
import { useMe } from "./Home";

export function PrivacyExplainer() {
  return (
    <ul style={{ paddingLeft: 20, lineHeight: 1.6 }}>
      <li>We only store a nickname, an avatar and an age band for each child: no full names, birthdays, photos, contact details or location.</li>
      <li>Children never get a password or an account. You pair their device, and you can remove it any time.</li>
      <li>Children only tap answers. Nothing is typed, recorded, filmed or sent to AI.</li>
      <li>No ads and no third-party trackers in Learn Together. Your child&apos;s nickname and answers never go into analytics.</li>
      <li>You can download or delete everything from the Privacy page whenever you like.</li>
    </ul>
  );
}

export default function Onboarding({ user }: { user: unknown }) {
  const router = useRouter();
  const { me, error, setMe } = useMe(false);
  const [step, setStep] = useState<"intro" | "children" | "pin">("intro");
  const [familyName, setFamilyName] = useState("");
  const [children, setChildren] = useState<Child[]>([]);
  const [pin, setPin] = useState("");
  const [pin2, setPin2] = useState("");
  const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!me) return;
    setChildren(me.children);
    if (me.family) setStep(me.children.length ? (me.family.hasPin ? "pin" : "pin") : "children");
    if (me.family && me.children.length && me.family.hasPin) router.replace("/learn");
  }, [me, router]);

  if (!me) return <LearnShell user={user} title="Get started">{error ? <ErrorNote error={error} /> : <Loading />}</LearnShell>;

  return (
    <LearnShell user={user} title="Get started">
      <div className="row justify-content-center">
        <div className="col-lg-8">
          <ol className={s.subnav} aria-label="Setup steps" style={{ marginBottom: 20 }}>
            {(["intro", "children", "pin"] as const).map((k, i) => (
              <li key={k}>
                <span className={step === k ? `${s.chip} ${s.active}` : s.chip} aria-current={step === k ? "step" : undefined}>
                  {i + 1}. {k === "intro" ? "Welcome" : k === "children" ? "Children" : "Family PIN"}
                </span>
              </li>
            ))}
          </ol>
          <ErrorNote error={err} />

          {step === "intro" && (
            <section className={s.card}>
              <h1 style={{ fontSize: 28 }}>Welcome to Learn Together</h1>
              <p>10 to 15 minute activities for you and your 6 to 9 year old: real-life maths missions and safe science at home. You guide with a simple script; your child explores, on your device or theirs.</p>
              <h2 style={{ marginTop: 16 }}>How we look after your family&apos;s data</h2>
              <PrivacyExplainer />
              {!me.family && (
                <div className={s.field}>
                  <label htmlFor="fam-name">Family name (optional)</label>
                  <input id="fam-name" value={familyName} onChange={(e) => setFamilyName(e.target.value)} maxLength={80} placeholder="e.g. The Garcias" />
                </div>
              )}
              <button
                className={s.btn}
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    if (!me.family) await parentApi.post("/api/learn/family", { name: familyName });
                    const m = await parentApi.get<typeof me>("/api/learn/me");
                    setMe(m);
                    setStep("children");
                  } catch (e) {
                    setErr(e);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Let&apos;s set up
              </button>
            </section>
          )}

          {step === "children" && (
            <section className={s.card}>
              <h1 style={{ fontSize: 26 }}>Add your children</h1>
              {children.map((c) => (
                <p key={c.id} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <Avatar avatarKey={c.avatarKey} /> <strong>{c.nickname}</strong> <span className={s.muted}>ages {c.ageBand}</span>
                </p>
              ))}
              <ChildForm key={children.length} submitLabel={children.length ? "Add another child" : "Add child"} onSaved={(c) => setChildren([...children, c])} />
              {children.length > 0 && (
                <button className={s.btn} style={{ marginTop: 16 }} onClick={() => setStep("pin")}>
                  Next: family PIN
                </button>
              )}
            </section>
          )}

          {step === "pin" && (
            <section className={s.card}>
              <h1 style={{ fontSize: 26 }}>Set a family PIN</h1>
              <p className={s.muted}>4 to 6 digits. Grown-ups use it to leave child mode on a child&apos;s device. Don&apos;t share it with your children.</p>
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  if (pin !== pin2) return setErr(new Error("The two PINs don't match"));
                  setBusy(true);
                  try {
                    if (!me.family?.hasPin) await parentApi.post("/api/learn/family/pin", { pin });
                    await parentApi.post("/api/learn/onboarding/complete");
                    router.push("/learn");
                  } catch (e2) {
                    setErr(e2);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {!me.family?.hasPin ? (
                  <>
                    <div className={s.field}>
                      <label htmlFor="pin1">Family PIN</label>
                      <input id="pin1" inputMode="numeric" pattern="\d{4,6}" type="password" autoComplete="new-password" value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 6))} required />
                    </div>
                    <div className={s.field}>
                      <label htmlFor="pin2">Type it again</label>
                      <input id="pin2" inputMode="numeric" pattern="\d{4,6}" type="password" autoComplete="new-password" value={pin2} onChange={(e) => setPin2(e.target.value.replace(/\D/g, "").slice(0, 6))} required />
                    </div>
                  </>
                ) : (
                  <p>Your family PIN is set.</p>
                )}
                <button className={s.btn} disabled={busy || (!me.family?.hasPin && pin.length < 4)}>
                  Finish
                </button>
              </form>
            </section>
          )}
        </div>
      </div>
    </LearnShell>
  );
}
