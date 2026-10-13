import React, { useCallback, useEffect, useRef, useState } from "react";
import Head from "next/head";
import Link from "next/link";
import { useRouter } from "next/router";
import Navbar from "@/components/_App/Navbar";
import Footer from "@/components/_App/Footer";
import s from "./lt.module.scss";
import { AVATAR_EMOJI, AVATAR_NAMES } from "./icons";
import { ApiError, parentApi } from "./api";
import { t } from "./i18n";

export { s };

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(" ");
}

export function Avatar({ avatarKey, large, label }: { avatarKey: string; large?: boolean; label?: string }) {
  return (
    <span className={large ? s.avatarLg : s.avatar} role="img" aria-label={label || AVATAR_NAMES[avatarKey] || "avatar"}>
      {AVATAR_EMOJI[avatarKey] || "🙂"}
    </span>
  );
}

export function Status({ online, label }: { online: boolean; label: string }) {
  return <span className={cx(s.status, online ? s.online : s.offline)}>{label}</span>;
}

export function ErrorNote({ error }: { error: unknown }) {
  if (!error) return null;
  const msg = error instanceof ApiError ? error.message : "Something went wrong. Please try again.";
  return (
    <div className={s.error} role="alert">
      {msg}
    </div>
  );
}

export function Loading({ label = "Loading…" }: { label?: string }) {
  return (
    <p className={s.muted} role="status" aria-live="polite">
      {label}
    </p>
  );
}

const SUBNAV: [string, string][] = [
  ["/learn", t("nav.home")],
  ["/learn/explore", t("nav.explore")],
  ["/learn/family", t("nav.family")],
  ["/learn/privacy", t("nav.privacy")],
];

/** Parent-area shell: the site's own Navbar and Footer around a Learn Together sub-navigation. */
export function LearnShell({ user, title, children, admin }: { user: unknown; title: string; children: React.ReactNode; admin?: boolean }) {
  const router = useRouter();
  const links: [string, string][] = admin ? [["/learn/admin", "Activities"], ["/learn/admin/metrics", "Metrics"], ["/learn", "Back to Learn Together"]] : SUBNAV;
  return (
    <>
      <Head>
        <title>{`${title} · Learn Together · Sharp Study`}</title>
      </Head>
      <Navbar user={user} />
      <main className={s.page} id="main">
        <div className="container">
          <nav aria-label="Learn Together">
            <ul className={s.subnav}>
              {links.map(([href, label]) => {
                const active = href === "/learn" || href === "/learn/admin" ? router.pathname === href : router.pathname.startsWith(href);
                return (
                  <li key={href}>
                    <Link href={href}>
                      <a className={active ? s.active : undefined} aria-current={active ? "page" : undefined}>
                        {label}
                      </a>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>
          {children}
        </div>
      </main>
      <Footer />
    </>
  );
}

export function Dialog({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      prev?.focus?.();
    };
  }, [onClose]);
  return (
    <div className={s.overlay} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={s.dialog} role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} ref={ref}>
        <h2 style={{ fontSize: 22, marginBottom: 12 }}>{title}</h2>
        {children}
      </div>
    </div>
  );
}

/** Asks for the parent's password and returns a short-lived re-auth token. */
export function useReauth() {
  const [pending, setPending] = useState<null | { resolve: (t: string | null) => void }>(null);
  const ask = useCallback(() => new Promise<string | null>((resolve) => setPending({ resolve })), []);
  const dialog = pending ? (
    <ReauthDialog
      onDone={(tok) => {
        pending.resolve(tok);
        setPending(null);
      }}
    />
  ) : null;
  return { ask, dialog };
}

function ReauthDialog({ onDone }: { onDone: (token: string | null) => void }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  return (
    <Dialog title="Confirm it's you" onClose={() => onDone(null)}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            const r = await parentApi.post<{ reauthToken: string }>("/api/learn/reauth", { password });
            onDone(r.reauthToken);
          } catch (err) {
            setError(err);
          } finally {
            setBusy(false);
          }
        }}
      >
        <p className={s.muted}>For your family&apos;s safety, enter your Sharp Study password to continue.</p>
        <ErrorNote error={error} />
        <div className={s.field}>
          <label htmlFor="lt-reauth-pw">Password</label>
          <input id="lt-reauth-pw" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </div>
        <div className={s.btnRow}>
          <button className={s.btn} disabled={busy || !password}>
            Continue
          </button>
          <button type="button" className={s.btnGhost} onClick={() => onDone(null)}>
            Cancel
          </button>
        </div>
      </form>
    </Dialog>
  );
}

/** On-device read-aloud via the browser's speechSynthesis. Nothing leaves the device. */
export function useReadAloud(enabled: boolean) {
  const supported = typeof window !== "undefined" && "speechSynthesis" in window;
  const speak = useCallback(
    (text?: string) => {
      if (!enabled || !supported || !text) return;
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.rate = 0.92;
      window.speechSynthesis.speak(u);
    },
    [enabled, supported]
  );
  useEffect(() => () => {
    if (supported) window.speechSynthesis.cancel();
  }, [supported]);
  return { speak, supported };
}

export function PinPad({ length = 4, max = 6, onSubmit, busy, label }: { length?: number; max?: number; onSubmit: (pin: string) => void; busy?: boolean; label: string }) {
  const [pin, setPin] = useState("");
  const press = (d: string) => setPin((p) => (p.length < max ? p + d : p));
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 14 }}>
      <div className={s.dots} aria-label={`${label}: ${pin.length} digits entered`} role="status">
        {Array.from({ length: Math.max(length, pin.length) }).map((_, i) => (
          <span key={i} className={i < pin.length ? s.filled : undefined} />
        ))}
      </div>
      <div className={s.pinPad}>
        {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
          <button key={d} type="button" onClick={() => press(d)} aria-label={d}>
            {d}
          </button>
        ))}
        <button type="button" onClick={() => setPin((p) => p.slice(0, -1))} aria-label="Delete">
          ⌫
        </button>
        <button type="button" onClick={() => press("0")} aria-label="0">
          0
        </button>
        <button type="button" disabled={busy || pin.length < length} onClick={() => onSubmit(pin)} aria-label="Enter PIN">
          ✓
        </button>
      </div>
    </div>
  );
}

export const fmtDate = (d: string | Date | null | undefined) => (d ? new Date(d).toLocaleDateString(undefined, { day: "numeric", month: "short" }) : "—");
export const fmtDateTime = (d: string | Date | null | undefined) => (d ? new Date(d).toLocaleString(undefined, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : "—");
export function timeAgo(d: string | Date | null | undefined) {
  if (!d) return "never";
  const s = Math.round((Date.now() - new Date(d).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} days ago`;
}
