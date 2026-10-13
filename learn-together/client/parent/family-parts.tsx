// Shared parent-side pieces: child form, pairing flow and approval prompts.
import React, { useEffect, useState } from "react";
import QRCode from "qrcode";
import { parentApi } from "../api";
import { AVATAR_EMOJI, AVATAR_NAMES, PICTURE_ICONS } from "../icons";
import { Avatar, Dialog, ErrorNote, s, cx } from "../ui";

export interface Child {
  id: string;
  nickname: string;
  avatarKey: string;
  ageBand: "6-7" | "7-8" | "8-9";
  language: string;
  readAloud: boolean;
  largeText: boolean;
  reducedMotion: boolean;
  subjectInterests: string[];
  hasPictureCode: boolean;
}

const INTERESTS = ["math", "science", "building", "nature", "cooking", "shopping", "sports", "art"];

export function ChildForm({ initial, onSaved, onCancel, submitLabel = "Save" }: { initial?: Partial<Child>; onSaved: (c: Child) => void; onCancel?: () => void; submitLabel?: string }) {
  const [form, setForm] = useState({
    nickname: initial?.nickname || "",
    avatarKey: initial?.avatarKey || "fox",
    ageBand: initial?.ageBand || "7-8",
    readAloud: !!initial?.readAloud,
    largeText: !!initial?.largeText,
    reducedMotion: !!initial?.reducedMotion,
    subjectInterests: initial?.subjectInterests || [],
  });
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: string, v: unknown) => setForm((f) => ({ ...f, [k]: v }));
  const idp = initial?.id || "new";

  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
          const r = initial?.id ? await parentApi.patch<{ child: Child }>(`/api/learn/children/${initial.id}`, form) : await parentApi.post<{ child: Child }>("/api/learn/children", form);
          onSaved(r.child);
        } catch (err) {
          setError(err);
        } finally {
          setBusy(false);
        }
      }}
    >
      <ErrorNote error={error} />
      <div className={s.field}>
        <label htmlFor={`nick-${idp}`}>Nickname</label>
        <input id={`nick-${idp}`} value={form.nickname} onChange={(e) => set("nickname", e.target.value)} maxLength={40} required autoComplete="off" />
        <p className={s.hint}>A first name or nickname only. We never ask for full names, birthdays or contact details.</p>
      </div>
      <fieldset className={s.field}>
        <legend className={s.label}>Avatar</legend>
        <div className={s.chips}>
          {Object.keys(AVATAR_EMOJI).map((k) => (
            <button key={k} type="button" className={s.chipToggle} aria-pressed={form.avatarKey === k} onClick={() => set("avatarKey", k)} aria-label={AVATAR_NAMES[k]}>
              <span aria-hidden="true" style={{ fontSize: 22 }}>
                {AVATAR_EMOJI[k]}
              </span>
            </button>
          ))}
        </div>
      </fieldset>
      <fieldset className={s.field}>
        <legend className={s.label}>Age band</legend>
        <div className={s.segmented}>
          {(["6-7", "7-8", "8-9"] as const).map((b) => (
            <button key={b} type="button" aria-pressed={form.ageBand === b} onClick={() => set("ageBand", b)}>
              {b}
            </button>
          ))}
        </div>
      </fieldset>
      <details className={s.field}>
        <summary className={s.label} style={{ cursor: "pointer" }}>
          Optional: accessibility and interests
        </summary>
        {(
          [
            ["readAloud", "Read instructions aloud on the child's device"],
            ["largeText", "Larger text"],
            ["reducedMotion", "Reduce animation"],
          ] as const
        ).map(([k, label]) => (
          <label key={k} style={{ display: "flex", gap: 8, alignItems: "center", fontWeight: 400, minHeight: 32 }}>
            <input type="checkbox" checked={form[k]} onChange={(e) => set(k, e.target.checked)} style={{ width: 20, minHeight: 20 }} />
            {label}
          </label>
        ))}
        <div className={s.chips} style={{ marginTop: 10 }} role="group" aria-label="Interests">
          {INTERESTS.map((i) => (
            <button
              key={i}
              type="button"
              className={s.chipToggle}
              aria-pressed={form.subjectInterests.includes(i)}
              onClick={() => set("subjectInterests", form.subjectInterests.includes(i) ? form.subjectInterests.filter((x) => x !== i) : [...form.subjectInterests, i])}
            >
              {i}
            </button>
          ))}
        </div>
      </details>
      <div className={s.btnRow}>
        <button className={s.btn} disabled={busy || !form.nickname.trim()}>
          {submitLabel}
        </button>
        {onCancel && (
          <button type="button" className={s.btnGhost} onClick={onCancel}>
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}

export function PictureCodeEditor({ child, onDone }: { child: Child; onDone: () => void }) {
  const [code, setCode] = useState<string[]>([]);
  const [error, setError] = useState<unknown>(null);
  const save = async (value: string[] | null) => {
    try {
      await parentApi.put(`/api/learn/children/${child.id}/picture-code`, { code: value });
      onDone();
    } catch (e) {
      setError(e);
    }
  };
  return (
    <Dialog title={`Picture code for ${child.nickname}`} onClose={onDone}>
      <p className={s.muted}>On a shared device, {child.nickname} taps these three pictures in order to open their lobby. Optional.</p>
      <ErrorNote error={error} />
      <p aria-live="polite" style={{ fontSize: 32, minHeight: 44 }}>
        {code.map((c) => PICTURE_ICONS[c]).join(" ") || "—"}
      </p>
      <div className={s.chips} style={{ marginBottom: 16 }}>
        {Object.entries(PICTURE_ICONS).map(([k, icon]) => (
          <button key={k} type="button" className={s.chipToggle} disabled={code.length >= 3} onClick={() => setCode([...code, k])} aria-label={k}>
            <span style={{ fontSize: 24 }} aria-hidden="true">
              {icon}
            </span>
          </button>
        ))}
      </div>
      <div className={s.btnRow}>
        <button className={s.btn} disabled={code.length !== 3} onClick={() => save(code)}>
          Save code
        </button>
        <button className={s.btnGhost} onClick={() => setCode([])}>
          Start over
        </button>
        {child.hasPictureCode && (
          <button className={s.btnDanger} onClick={() => save(null)}>
            Remove code
          </button>
        )}
      </div>
    </Dialog>
  );
}

export interface PendingApproval {
  requestId: string;
  claimedAt: string;
  deviceLabelSuggestion: string;
  children: { id: string; nickname: string; avatarKey: string }[];
}

export function ApprovalPrompt({ request, onResolved }: { request: PendingApproval; onResolved: () => void }) {
  const names = request.children.map((c) => c.nickname).join(" & ");
  const [label, setLabel] = useState(`${names}'s ${request.deviceLabelSuggestion || "device"}`.slice(0, 60));
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const decide = async (decision: "approve" | "deny") => {
    setBusy(true);
    try {
      await parentApi.post(`/api/learn/pairing/${request.requestId}`, { decision, label });
      onResolved();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className={s.card} aria-live="assertive" style={{ borderColor: "#fec400", borderWidth: 2 }}>
      <h2>A new device wants to join as {names}. Approve?</h2>
      <p className={s.muted}>Only approve if you just showed this code on a device in your home.</p>
      <ErrorNote error={error} />
      <div className={s.field}>
        <label htmlFor={`label-${request.requestId}`}>Device name</label>
        <input id={`label-${request.requestId}`} value={label} onChange={(e) => setLabel(e.target.value)} maxLength={60} />
      </div>
      <div className={s.btnRow}>
        <button className={s.btn} disabled={busy || !label.trim()} onClick={() => decide("approve")}>
          Approve
        </button>
        <button className={s.btnDanger} disabled={busy} onClick={() => decide("deny")}>
          Deny
        </button>
      </div>
    </section>
  );
}

/** Parent shows a QR code + 6-character code; the child device enters it at /learn/join. */
export function PairDeviceDialog({ kids, onClose }: { kids: Child[]; onClose: () => void }) {
  const [selected, setSelected] = useState<string[]>(kids.length === 1 ? [kids[0].id] : []);
  const [pairing, setPairing] = useState<{ requestId: string; code: string; expiresAt: string } | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [status, setStatus] = useState<string>("waiting");
  const [pending, setPending] = useState<PendingApproval | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (!pairing) return;
    const url = `${window.location.origin}/learn/join?c=${pairing.code}`;
    QRCode.toDataURL(url, { margin: 1, width: 400, errorCorrectionLevel: "M" }).then(setQr, () => setQr(null));
    let alive = true;
    const tick = async () => {
      try {
        const st = await parentApi.get<{ status: string }>(`/api/learn/pairing/${pairing.requestId}`);
        if (!alive) return;
        setStatus(st.status);
        if (st.status === "claimed") {
          const p = await parentApi.get<{ pending: PendingApproval[] }>("/api/learn/pairing");
          setPending(p.pending.find((x) => x.requestId === pairing.requestId) || null);
        }
      } catch (e) {
        setError(e);
      }
    };
    void tick();
    const id = setInterval(tick, 2000);
    const clock = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      alive = false;
      clearInterval(id);
      clearInterval(clock);
    };
  }, [pairing]);

  const remaining = pairing ? Math.max(0, Math.round((new Date(pairing.expiresAt).getTime() - now) / 1000)) : 0;

  return (
    <Dialog title="Pair a child's device" onClose={onClose}>
      <ErrorNote error={error} />
      {!pairing && (
        <>
          <p className={s.muted}>Choose who will use the device. A shared device can have more than one child.</p>
          <div className={s.chips} style={{ marginBottom: 16 }}>
            {kids.map((c) => (
              <button key={c.id} type="button" className={s.chipToggle} aria-pressed={selected.includes(c.id)} onClick={() => setSelected(selected.includes(c.id) ? selected.filter((x) => x !== c.id) : [...selected, c.id])}>
                <span aria-hidden="true">{AVATAR_EMOJI[c.avatarKey]}</span> {c.nickname}
              </button>
            ))}
          </div>
          <button
            className={s.btn}
            disabled={!selected.length}
            onClick={async () => {
              try {
                setPairing(await parentApi.post("/api/learn/pairing", { childProfileIds: selected }));
              } catch (e) {
                setError(e);
              }
            }}
          >
            Show pairing code
          </button>
        </>
      )}
      {pairing && status === "waiting" && (
        <div style={{ textAlign: "center" }}>
          <p>
            On the child&apos;s device, open <strong>sharpstudy.io/learn/join</strong> and type this code, or scan the QR code.
          </p>
          {qr && <img src={qr} alt={`QR code for pairing code ${pairing.code.split("").join(" ")}`} className={s.qr} />}
          <p className={s.code} aria-label={`Code: ${pairing.code.split("").join(" ")}`}>
            {pairing.code}
          </p>
          <p className={s.muted} role="timer">
            {remaining > 0 ? `Expires in ${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, "0")}` : "This code has expired."}
          </p>
        </div>
      )}
      {pending && (status === "claimed" || status === "waiting") && <ApprovalPrompt request={pending} onResolved={() => setStatus("resolved")} />}
      {(status === "approved" || status === "paired" || status === "resolved") && (
        <div className={s.success} role="status">
          Done. If you approved, the device opens the child lobby within a few seconds.
        </div>
      )}
      {status === "denied" && <div className={s.alert}>Pairing was denied.</div>}
      <div className={cx(s.btnRow)} style={{ marginTop: 12 }}>
        <button className={s.btnGhost} onClick={onClose}>
          Close
        </button>
      </div>
    </Dialog>
  );
}

export function ChildChip({ child }: { child: { nickname: string; avatarKey: string } }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
      <Avatar avatarKey={child.avatarKey} />
      <strong>{child.nickname}</strong>
    </span>
  );
}
