// Child follower view: one instruction per screen, big targets, optional read-aloud, the step's
// interaction, and a persistent "I need help". Renders only the child projection.
import React, { useEffect, useMemo, useState } from "react";
import type { ChildActivityView, ChildInteraction, ChildScreenView } from "@/learn-together/domain/projection";
import { Avatar, cx, s, useReadAloud } from "../ui";
import { t } from "../i18n";
import { conceptLabel } from "../concepts";

export interface FollowerChild {
  id: string;
  nickname: string;
  avatarKey: string;
  ready: boolean;
  answered: string[];
  helpPending: boolean;
  readAloud?: boolean;
  reducedMotion?: boolean;
}

export interface FollowerProps {
  activity: ChildActivityView;
  state: "lobby" | "active" | "paused" | "ended";
  stepIndex: number;
  kids: FollowerChild[];
  onReady: (childId: string) => Promise<unknown>;
  onRespond: (childId: string, itemKey: string, value: unknown) => Promise<unknown>;
  onHelp: (childId: string) => Promise<unknown>;
  readAloud: boolean;
  reducedMotion: boolean;
  offline?: boolean;
  onFinished?: () => void;
}

function NumberEntry({ unit, onSubmit, disabled }: { unit?: string; onSubmit: (n: number) => void; disabled: boolean }) {
  const [v, setV] = useState("");
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
      <div className={s.numberDisplay} aria-live="polite" aria-label={`Your number: ${v || "empty"}`}>
        {v || "?"} {unit && <span style={{ fontSize: "0.5em", marginLeft: 8 }}>{unit}</span>}
      </div>
      <div className={s.numberPad}>
        {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
          <button key={d} type="button" onClick={() => setV((x) => (x.length < 4 ? x + d : x))}>
            {d}
          </button>
        ))}
        <button type="button" onClick={() => setV((x) => x.slice(0, -1))} aria-label={t("kid.clear")}>
          ⌫
        </button>
        <button type="button" onClick={() => setV((x) => (x.length < 4 ? x + "0" : x))}>
          0
        </button>
        <button type="button" disabled={!v || disabled} onClick={() => onSubmit(Number(v))} aria-label={t("kid.send")}>
          ✓
        </button>
      </div>
    </div>
  );
}

function Ordering({ items, onSubmit, disabled }: { items: { key: string; label: string }[]; onSubmit: (keys: string[]) => void; disabled: boolean }) {
  const [order, setOrder] = useState(items);
  const move = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= order.length) return;
    const next = order.slice();
    [next[i], next[j]] = [next[j], next[i]];
    setOrder(next);
  };
  return (
    <div style={{ width: "100%", display: "flex", flexDirection: "column", alignItems: "center" }}>
      <ol className={s.orderList}>
        {order.map((it, i) => (
          <li key={it.key}>
            <span>
              {i + 1}. {it.label}
            </span>
            <span style={{ display: "flex", gap: 6 }}>
              <button type="button" onClick={() => move(i, -1)} disabled={i === 0} aria-label={`Move ${it.label} up`}>
                ↑
              </button>
              <button type="button" onClick={() => move(i, 1)} disabled={i === order.length - 1} aria-label={`Move ${it.label} down`}>
                ↓
              </button>
            </span>
          </li>
        ))}
      </ol>
      <button className={s.bigBtn} disabled={disabled} onClick={() => onSubmit(order.map((o) => o.key))}>
        {t("kid.done")}
      </button>
    </div>
  );
}

function InteractionView({ inter, onAnswer, disabled }: { inter: ChildInteraction; onAnswer: (v: unknown) => void; disabled: boolean }) {
  const [picked, setPicked] = useState<string | null>(null);
  switch (inter.type) {
    case "done_button":
      return (
        <button className={s.bigBtn} disabled={disabled} onClick={() => onAnswer(true)}>
          {t("kid.done")}
        </button>
      );
    case "ready_button":
      return (
        <button className={s.bigBtnYellow} disabled={disabled} onClick={() => onAnswer(true)}>
          {t("kid.ready")}
        </button>
      );
    case "choice":
      return (
        <div className={s.choiceGrid} role="group">
          {inter.options.map((o) => (
            <button
              key={o.key}
              type="button"
              aria-pressed={picked === o.key}
              disabled={disabled}
              onClick={() => {
                setPicked(o.key);
                onAnswer(o.key);
              }}
            >
              {o.label}
            </button>
          ))}
        </div>
      );
    case "number_entry":
      return <NumberEntry unit={inter.unit} onSubmit={(n) => onAnswer(n)} disabled={disabled} />;
    case "ordering":
      return <Ordering items={inter.items} onSubmit={(k) => onAnswer(k)} disabled={disabled} />;
  }
}

export default function Follower(p: FollowerProps) {
  const { speak, supported } = useReadAloud(p.readAloud);
  const [who, setWho] = useState<string | null>(p.kids.length === 1 ? p.kids[0].id : null);
  const [busy, setBusy] = useState(false);
  const [justAnswered, setJustAnswered] = useState<string | null>(null);
  const step = p.activity.steps[Math.min(p.stepIndex, p.activity.steps.length - 1)];
  const child = p.kids.find((c) => c.id === who) || null;

  // Screens to show this step: the step itself, plus check questions during the check step.
  const screens = useMemo(() => {
    const list: { key: string; view: ChildScreenView }[] = [{ key: `step:${step.id}`, view: step }];
    if (step.isCheck) for (const c of p.activity.checks) list.push({ key: `check:${c.key}`, view: c });
    return list;
  }, [step, p.activity.checks]);

  useEffect(() => {
    if (p.state === "active") speak(step.readAloudText || step.screen);
    setJustAnswered(null);
  }, [step.id, p.state]); // eslint-disable-line react-hooks/exhaustive-deps

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  };

  const whoPicker = (
    <div className={s.kidMain}>
      <h1 className={s.kidScreen}>{t("kid.whoAnswering")}</h1>
      <div className={s.avatarPick}>
        {p.kids.map((c) => (
          <button key={c.id} onClick={() => setWho(c.id)}>
            <Avatar avatarKey={c.avatarKey} large label={c.nickname} />
            {c.nickname}
          </button>
        ))}
      </div>
    </div>
  );

  if (p.state === "ended") {
    return (
      <div className={cx(s.kidMain, s.pop)} role="status">
        <div style={{ fontSize: 80 }} aria-hidden="true">
          🎉
        </div>
        <h1 className={s.kidScreen}>{t("kid.close", { concept: p.activity.conceptTags.map(conceptLabel).slice(0, 2).join(" and ") })}</h1>
        {p.onFinished && (
          <button className={s.bigBtn} onClick={p.onFinished}>
            OK
          </button>
        )}
      </div>
    );
  }

  if (p.state === "lobby") {
    return (
      <div className={cx(s.kidMain, s.pop)}>
        <p style={{ margin: 0 }}>Today we&apos;re exploring</p>
        <h1 className={s.kidScreen}>{p.activity.title}</h1>
        {p.kids.map((c) => (
          <div key={c.id} style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <Avatar avatarKey={c.avatarKey} large label={c.nickname} />
            {c.ready ? (
              <strong>Ready! ✓</strong>
            ) : (
              <button className={s.bigBtnYellow} disabled={busy} onClick={() => act(() => p.onReady(c.id))}>
                {p.kids.length > 1 ? `${c.nickname}: ${t("kid.ready")}` : t("kid.ready")}
              </button>
            )}
          </div>
        ))}
      </div>
    );
  }

  if (!child) return whoPicker;

  return (
    <>
      <div className={s.kidMain} key={step.id}>
        <ol className={s.kidProgress} aria-label={`Step ${step.index + 1} of ${step.total}`}>
          {Array.from({ length: step.total }).map((_, i) => (
            <li key={i} className={i < step.index ? s.done : i === step.index ? s.current : undefined} />
          ))}
        </ol>
        {p.state === "paused" && (
          <p className={s.alert} role="status">
            {t("kid.paused")}
          </p>
        )}
        {screens.map(({ key, view }, i) => {
          const answered = child.answered.includes(key) || justAnswered === key;
          return (
            <section key={key} className={cx(i === 0 && s.pop)} style={{ width: "100%", display: "flex", flexDirection: "column", alignItems: "center", gap: 16, marginTop: i ? 24 : 0 }} aria-label={i === 0 ? "Instruction" : "Question"}>
              <h1 className={s.kidScreen} aria-live="polite">
                {view.screen}
              </h1>
              {supported && p.readAloud && (
                <button className={s.grownUpBtn} onClick={() => speak(view.readAloudText || view.screen)}>
                  🔊 {t("kid.listen")}
                </button>
              )}
              {view.interaction && !answered && (
                <InteractionView inter={view.interaction} disabled={busy || p.state !== "active"} onAnswer={(v) => act(async () => { await p.onRespond(child.id, key, v); setJustAnswered(key); })} />
              )}
              {view.interaction && answered && (
                <p className={s.success} role="status" style={{ fontSize: "0.9em" }}>
                  {view.interaction.type === "done_button" || view.interaction.type === "ready_button" ? "✓" : t("kid.answered")}
                </p>
              )}
            </section>
          );
        })}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 16, gap: 12 }}>
        {p.kids.length > 1 ? (
          <button className={s.grownUpBtn} onClick={() => setWho(null)} aria-label={`Answering: ${child.nickname}. Change`}>
            <Avatar avatarKey={child.avatarKey} /> {child.nickname}
          </button>
        ) : (
          <span />
        )}
        <button className={s.helpBtn} aria-pressed={child.helpPending} disabled={busy || child.helpPending} onClick={() => act(() => p.onHelp(child.id))}>
          {child.helpPending ? `🙋 ${t("kid.helpSent")}` : `🙋 ${t("kid.help")}`}
        </button>
      </div>
      {p.offline && (
        <p className={s.muted} role="status" style={{ textAlign: "center" }}>
          {t("kid.offline")}
        </p>
      )}
    </>
  );
}
