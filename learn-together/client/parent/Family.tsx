import React, { useCallback, useEffect, useState } from "react";
import { parentApi } from "../api";
import { Avatar, ErrorNote, LearnShell, Loading, Status, s, timeAgo, useReauth, fmtDate } from "../ui";
import { ChildForm, PairDeviceDialog, PictureCodeEditor, type Child } from "./family-parts";
import { useMe } from "./Home";

interface Device {
  id: string;
  label: string;
  pairedAt: string;
  lastSeenAt: string | null;
  online: boolean;
  childProfileIds: string[];
}

export default function Family({ user }: { user: unknown }) {
  const { me, error, setMe } = useMe();
  const [devices, setDevices] = useState<Device[]>([]);
  const [err, setErr] = useState<unknown>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [codeFor, setCodeFor] = useState<Child | null>(null);
  const [pairing, setPairing] = useState(false);
  const [pin, setPin] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const reauth = useReauth();

  const reload = useCallback(async () => {
    try {
      const [m, d] = await Promise.all([parentApi.get<NonNullable<typeof me>>("/api/learn/me"), parentApi.get<{ devices: Device[] }>("/api/learn/devices")]);
      setMe(m);
      setDevices(d.devices);
    } catch (e) {
      setErr(e);
    }
  }, [setMe]);

  useEffect(() => {
    if (me) parentApi.get<{ devices: Device[] }>("/api/learn/devices").then((d) => setDevices(d.devices), setErr);
  }, [me?.family?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!me) return <LearnShell user={user} title="Family">{error ? <ErrorNote error={error} /> : <Loading />}</LearnShell>;
  const isOwner = me.user.familyRole === "owner";
  const kidName = (id: string) => me.children.find((c) => c.id === id)?.nickname || "a removed child";

  return (
    <LearnShell user={user} title="Family">
      {reauth.dialog}
      <div className={s.pageHead}>
        <div>
          <h1>{me.family?.name || "Your family"}</h1>
          <p>Children, devices and the grown-ups who can help.</p>
        </div>
        <button className={s.btn} onClick={() => setPairing(true)} disabled={!me.children.length}>
          Pair a device
        </button>
      </div>
      <ErrorNote error={err} />
      {notice && (
        <div className={s.success} role="status">
          {notice}
        </div>
      )}

      <section className={s.card} aria-labelledby="kids-h">
        <h2 id="kids-h">Children</h2>
        {me.children.map((c) => (
          <div key={c.id} style={{ borderBottom: "1px solid #e3ebf2", padding: "12px 0" }}>
            {editing === c.id ? (
              <ChildForm
                initial={c}
                onSaved={() => {
                  setEditing(null);
                  void reload();
                }}
                onCancel={() => setEditing(null)}
              />
            ) : (
              <div className={s.btnRow} style={{ justifyContent: "space-between" }}>
                <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <Avatar avatarKey={c.avatarKey} />
                  <span>
                    <strong>{c.nickname}</strong>
                    <br />
                    <span className={s.muted}>
                      Ages {c.ageBand}
                      {c.hasPictureCode ? " · picture code on" : ""}
                    </span>
                  </span>
                </span>
                <span className={s.btnRow}>
                  <button className={`${s.btnGhost} ${s.btnSmall}`} onClick={() => setEditing(c.id)}>
                    Edit
                  </button>
                  <button className={`${s.btnGhost} ${s.btnSmall}`} onClick={() => setCodeFor(c)}>
                    Picture code
                  </button>
                  <button
                    className={`${s.btnDanger} ${s.btnSmall}`}
                    onClick={async () => {
                      if (!window.confirm(`Delete ${c.nickname} and all of their Learn Together history? This can't be undone.`)) return;
                      const token = await reauth.ask();
                      if (!token) return;
                      try {
                        const r = await parentApi.del<{ revokedDevices: number }>(`/api/learn/children/${c.id}`, token);
                        setNotice(`${c.nickname}'s profile and history were deleted.${r.revokedDevices ? ` ${r.revokedDevices} device(s) were unpaired.` : ""}`);
                        void reload();
                      } catch (e) {
                        setErr(e);
                      }
                    }}
                  >
                    Delete
                  </button>
                </span>
              </div>
            )}
          </div>
        ))}
        {adding ? (
          <div style={{ marginTop: 16 }}>
            <ChildForm
              submitLabel="Add child"
              onSaved={() => {
                setAdding(false);
                void reload();
              }}
              onCancel={() => setAdding(false)}
            />
          </div>
        ) : (
          <button className={s.btnGhost} style={{ marginTop: 16 }} onClick={() => setAdding(true)}>
            Add a child
          </button>
        )}
      </section>

      <section className={s.card} aria-labelledby="dev-h">
        <h2 id="dev-h">Paired devices</h2>
        {!devices.length && <p className={s.muted}>No devices yet. Pair one so lessons open on your child&apos;s own screen.</p>}
        <div className={s.tableWrap}>
          {devices.length > 0 && (
            <table className={s.table}>
              <thead>
                <tr>
                  <th scope="col">Device</th>
                  <th scope="col">For</th>
                  <th scope="col">Status</th>
                  <th scope="col">Paired</th>
                  <th scope="col">
                    <span className={s.srOnly}>Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {devices.map((d) => (
                  <tr key={d.id}>
                    <td>{d.label}</td>
                    <td>{d.childProfileIds.map(kidName).join(", ")}</td>
                    <td>
                      <Status online={d.online} label={d.online ? "Online" : `Last seen ${timeAgo(d.lastSeenAt)}`} />
                    </td>
                    <td>{fmtDate(d.pairedAt)}</td>
                    <td>
                      <button
                        className={`${s.btnDanger} ${s.btnSmall}`}
                        onClick={async () => {
                          if (!window.confirm(`Revoke "${d.label}"? It will leave Learn Together straight away.`)) return;
                          try {
                            await parentApi.del(`/api/learn/devices/${d.id}`);
                            setNotice(`"${d.label}" was revoked.`);
                            void reload();
                          } catch (e) {
                            setErr(e);
                          }
                        }}
                      >
                        Revoke
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>

      <section className={s.card} aria-labelledby="pin-h">
        <h2 id="pin-h">Family PIN</h2>
        <p className={s.muted}>Used to leave child mode on a child&apos;s device. Changing it asks for your password.</p>
        <form
          className={s.btnRow}
          onSubmit={async (e) => {
            e.preventDefault();
            const token = await reauth.ask();
            if (!token) return;
            try {
              await parentApi.post("/api/learn/family/pin", { pin }, token);
              setPin("");
              setNotice("Family PIN updated.");
            } catch (e2) {
              setErr(e2);
            }
          }}
        >
          <div className={s.field} style={{ margin: 0 }}>
            <label htmlFor="newpin" className={s.srOnly}>
              New PIN
            </label>
            <input id="newpin" type="password" inputMode="numeric" autoComplete="new-password" placeholder="New PIN (4–6 digits)" value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 6))} />
          </div>
          <button className={s.btn} disabled={pin.length < 4}>
            Change PIN
          </button>
        </form>
      </section>

      <section className={s.card} aria-labelledby="cg-h">
        <h2 id="cg-h">Grown-ups</h2>
        <ul style={{ paddingLeft: 18 }}>
          {me.members.map((m) => (
            <li key={m.userId} style={{ marginBottom: 6 }}>
              {m.firstName || m.email} <span className={s.muted}>({m.role}{m.isYou ? ", you" : ""})</span>
              {isOwner && m.role === "caregiver" && (
                <button
                  className={`${s.btnGhost} ${s.btnSmall}`}
                  style={{ marginLeft: 8 }}
                  onClick={async () => {
                    await parentApi.del(`/api/learn/caregivers?userId=${encodeURIComponent(m.userId)}`).catch(setErr);
                    void reload();
                  }}
                >
                  Remove
                </button>
              )}
            </li>
          ))}
          {me.invites.map((i) => (
            <li key={i.id} className={s.muted}>
              Invited {i.email} (expires {fmtDate(i.expiresAt)})
              {isOwner && (
                <button
                  className={`${s.btnGhost} ${s.btnSmall}`}
                  style={{ marginLeft: 8 }}
                  onClick={async () => {
                    await parentApi.del(`/api/learn/caregivers?inviteId=${encodeURIComponent(i.id)}`).catch(setErr);
                    void reload();
                  }}
                >
                  Cancel invite
                </button>
              )}
            </li>
          ))}
        </ul>
        {isOwner && (
          <form
            className={s.btnRow}
            onSubmit={async (e) => {
              e.preventDefault();
              try {
                const r = await parentApi.post<{ emailed: boolean; link?: string }>("/api/learn/caregivers", { email: inviteEmail });
                setInviteEmail("");
                setInviteLink(r.link || null);
                setNotice(r.emailed ? "Invite sent." : "Invite created. Share the link below with them.");
                void reload();
              } catch (e2) {
                setErr(e2);
              }
            }}
          >
            <div className={s.field} style={{ margin: 0, flex: "1 1 240px" }}>
              <label htmlFor="cg-email" className={s.srOnly}>
                Their email
              </label>
              <input id="cg-email" type="email" placeholder="Another parent or caregiver's email" value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} required />
            </div>
            <button className={s.btn}>Invite</button>
          </form>
        )}
        {inviteLink && (
          <p style={{ marginTop: 10, wordBreak: "break-all" }}>
            <span className={s.muted}>Invite link (valid 7 days, only for that email): </span>
            <code>{inviteLink}</code>
          </p>
        )}
      </section>

      {codeFor && (
        <PictureCodeEditor
          child={codeFor}
          onDone={() => {
            setCodeFor(null);
            void reload();
          }}
        />
      )}
      {pairing && (
        <PairDeviceDialog
          kids={me.children}
          onClose={() => {
            setPairing(false);
            void reload();
          }}
        />
      )}
    </LearnShell>
  );
}
