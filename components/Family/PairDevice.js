// Pair a device (QR + 6-character code, expiry, live status) and the parent's approval card.
// Every state here comes from the server: "waiting" only while the code is open, "approve" only once
// the child's device has really redeemed it, "connected" only after the server recorded the approval.
import React, { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Avatar, Icon } from "./art";
import { QrCode, useCountdown, mmss } from "./controls";
import { parent } from "@/lib/family/client";

const timeAgo = (iso) => {
	const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
	if (s < 60) return "just now";
	const m = Math.round(s / 60);
	return m === 1 ? "1 min ago" : `${m} min ago`;
};
const joinHost = () => (typeof window === "undefined" ? "sharpstudy.io" : window.location.host);

const deviceIcon = (label) => (/iPad|tablet/i.test(label) ? "tablet" : /PC|Mac|Chromebook|Linux/i.test(label) ? "laptop" : "phone");

// ------------------------------------------------------------------ approval
export const ApprovalCard = ({ request, onDone, inPanel = false }) => {
	const first = request.learners[0];
	const guess = first ? `${first.nickname}'s ${request.label.split(" · ")[0]}` : "";
	const [name, setName] = useState("");
	const [busy, setBusy] = useState(null);
	const [error, setError] = useState(null);
	const who = request.learners.map((l) => l.nickname).join(" & ");

	const decide = async (action) => {
		setBusy(action);
		setError(null);
		try {
			const r = await parent.decide(request.id, { action, ...(action === "approve" && name.trim() ? { name: name.trim() } : {}) });
			onDone(action, r);
		} catch (e) {
			setError(e.message);
			setBusy(null);
			if (e.status === 409 || e.status === 404) onDone("stale");
		}
	};

	return (
		<section className={`fm-approval ${inPanel ? "fm-approval--in-panel" : ""}`} aria-labelledby={`appr-${request.id}`}>
			<div className="fm-approval__head">
				<span className="fm-approval__icon" aria-hidden="true">
					<Icon name={deviceIcon(request.label)} size={30} />
					{first && <span className="fm-approval__badge"><Avatar avatar={first.avatar} size={26} /></span>}
				</span>
				<div>
					<h3 className="fm-h3" id={`appr-${request.id}`}>A new device wants to join as {who}</h3>
					<p className="fm-muted">{request.label} · {timeAgo(request.requestedAt)}</p>
				</div>
			</div>
			<div className="fm-approval__row">
				<div className="fm-field">
					<label className="fm-label" htmlFor={`appr-name-${request.id}`}>Name this device</label>
					<input id={`appr-name-${request.id}`} className="fm-input" placeholder={guess} maxLength={60} value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" />
				</div>
			</div>
			<p className="fm-note" role="note">
				<Icon name="alert" size={20} />
				<span>Only approve a device that&apos;s with you right now. You can revoke it any time in Family.</span>
			</p>
			{error && <p className="fm-error" role="alert"><Icon name="alert" size={18} /> {error}</p>}
			<div className="fm-approval__actions">
				<button type="button" className="fm-btn fm-btn--primary" disabled={!!busy} onClick={() => decide("approve")}>{busy === "approve" ? "Approving…" : "Approve"}</button>
				<button type="button" className="fm-btn fm-btn--danger-text" disabled={!!busy} onClick={() => decide("deny")}>{busy === "deny" ? "Denying…" : "Deny"}</button>
			</div>
		</section>
	);
};

// A bottom sheet (phones) / centred card (large screens) for requests that arrive while no pairing panel is open.
export const ApprovalSheet = ({ request, onDone }) => (
	<div className="fm-modal fm-modal--approval" role="presentation">
		<div className="fm-sheet fm-sheet--approval" role="dialog" aria-modal="true" aria-label="Approve a new device">
			<span className="fm-sheet__grab" aria-hidden="true" />
			<ApprovalCard request={request} onDone={onDone} />
		</div>
	</div>
);

// ------------------------------------------------------------------ pairing panel
const PairPanel = ({ kids, initialIds, requests, onChanged, onClose, variant = "panel", backHref }) => {
	const [ids, setIds] = useState(initialIds);
	const [pairing, setPairing] = useState(null);
	const [state, setState] = useState({ status: "creating" });
	const [error, setError] = useState(null);
	const [nonce, setNonce] = useState(0);
	const live = useRef(null);
	const lastStatus = useRef("creating");
	const left = useCountdown(pairing && pairing.expiresAt);

	const names = useMemo(() => kids.filter((k) => ids.includes(k.id)).map((k) => k.nickname), [kids, ids]);
	const who = names.join(" & ") || "your child";

	// Create (or replace) the code whenever the chosen children change or "New code" is pressed.
	const idKey = ids.slice().sort().join(",");
	useEffect(() => {
		let alive = true;
		setState({ status: "creating" });
		setError(null);
		setPairing(null);
		parent
			.createPairing(ids)
			.then((r) => {
				if (!alive) return;
				live.current = r.pairing.id;
				lastStatus.current = "open";
				setPairing(r.pairing);
				setState({ status: "open" });
			})
			.catch((e) => alive && (setError(e), setState({ status: "error" })));
		return () => {
			alive = false;
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [idKey, nonce]);

	// Poll the server for what the child's device did with the code.
	useEffect(() => {
		if (!pairing || !["open", "claimed"].includes(state.status)) return;
		let alive = true;
		const tick = async () => {
			try {
				const r = await parent.pairing(pairing.id);
				if (!alive) return;
				const p = r.pairing;
				if (lastStatus.current !== p.status) {
					lastStatus.current = p.status;
					onChanged();
				}
				setState({ status: p.status, device: p.device });
			} catch (e) {
				/* transient: keep the last known state */
			}
		};
		const t = setInterval(tick, 2500);
		return () => {
			alive = false;
			clearInterval(t);
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [pairing, state.status]);

	const cancel = async () => {
		if (pairing && ["open", "claimed"].includes(state.status) && state.status === "open") {
			try {
				await parent.cancelPairing(pairing.id);
			} catch (e) {
				/* the code expires on its own */
			}
		}
		onClose();
	};

	const toggle = (id) => setIds((cur) => (cur.includes(id) ? (cur.length > 1 ? cur.filter((x) => x !== id) : cur) : [...cur, id]));
	const url = pairing && typeof window !== "undefined" ? `${window.location.origin}${pairing.joinPath}` : "";
	const expired = state.status === "expired" || (state.status === "open" && pairing && left === 0);
	const request = state.device && requests.find((r) => r.id === state.device.id);
	const ttl = pairing ? pairing.ttlSeconds : 600;
	const code = pairing ? pairing.display.split("") : [];

	return (
		<section className={`fm-pair fm-pair--${variant}`} aria-labelledby="fm-pair-title">
			<header className="fm-pair__head">
				{variant === "page" ? (
					<div className="fm-pair__titlebar">
						{backHref ? (
							<Link href={backHref}><a className="fm-iconbtn" aria-label="Back"><Icon name="back" size={22} /></a></Link>
						) : (
							<button type="button" className="fm-iconbtn" onClick={cancel} aria-label="Back"><Icon name="back" size={22} /></button>
						)}
						<h2 className="fm-h2" id="fm-pair-title">Pair a device</h2>
					</div>
				) : (
					<div className="fm-pair__titlebar">
						<div>
							<h2 className="fm-h2" id="fm-pair-title">Pair a device for {who}</h2>
							<p className="fm-muted">On the child&apos;s device, open <strong>{joinHost()}/learn/join</strong> or scan with its camera app.</p>
						</div>
						<button type="button" className="fm-iconbtn" onClick={cancel} aria-label="Close pairing"><Icon name="close" size={22} /></button>
					</div>
				)}
			</header>

			{kids.length > 1 && (
				<fieldset className="fm-pair__who">
					<legend className="fm-label">This device is for</legend>
					<div className="fm-chips">
						{kids.map((k) => {
							const on = ids.includes(k.id);
							return (
								<button key={k.id} type="button" className={`fm-chip ${on ? "is-on" : ""}`} aria-pressed={on} onClick={() => toggle(k.id)}>
									<Avatar avatar={k.avatar} size={30} />
									<span>{k.nickname}</span>
									{on && <Icon name="check" size={18} />}
								</button>
							);
						})}
					</div>
					<p className="fm-muted">Pick both for a shared family tablet.</p>
				</fieldset>
			)}

			{state.status === "error" && error && (
				<div className="fm-card fm-pair__error" role="alert">
					<p className="fm-error"><Icon name="alert" size={18} /> {error.message}</p>
					{error.code === "pin_required" && (
						<Link href="/family/setup/?step=2"><a className="fm-btn fm-btn--primary">Set a family PIN</a></Link>
					)}
					{error.code !== "pin_required" && <button type="button" className="fm-btn fm-btn--secondary" onClick={() => setNonce((n) => n + 1)}>Try again</button>}
				</div>
			)}

			{state.status !== "error" && (
				<div className="fm-card fm-pair__card">
					<div className="fm-pair__code-row">
						<div className={`fm-pair__qr ${expired || ["approved", "denied", "cancelled"].includes(state.status) ? "is-dim" : ""}`}>
							{url ? <QrCode value={url} size={variant === "page" ? 190 : 170} /> : <span className="fm-qr fm-qr--loading" aria-label="Making a code" role="status" />}
						</div>
						<div className="fm-pair__code">
							<p className="fm-label" id="fm-code-lbl">Or type {variant === "page" ? <>this code on <strong>{joinHost()}/learn/join</strong></> : "the code"}</p>
							<p className="fm-pair__chars" aria-labelledby="fm-code-lbl" aria-live="off">
								{code.length ? (
									<span aria-label={pairing.display.replace("-", " ").split("").join(" ")}>
										{code.map((c, i) => (c === "-" ? <span key={i} className="fm-pair__dash" aria-hidden="true" /> : <span key={i} className="fm-pair__char" aria-hidden="true">{c}</span>))}
									</span>
								) : (
									<span className="fm-muted">…</span>
								)}
							</p>
							<div className="fm-meter" role="progressbar" aria-label="Time left on this code" aria-valuemin={0} aria-valuemax={ttl} aria-valuenow={Math.min(ttl, left)}>
								<span style={{ width: `${Math.max(0, Math.min(100, (left / ttl) * 100))}%` }} />
							</div>
							<p className="fm-pair__meta">
								<span>Single use</span>
								<span>{expired ? "Expired" : `Expires in ${mmss(left)}`}</span>
							</p>
						</div>
					</div>
				</div>
			)}

			{state.status === "open" && !expired && (
				<p className="fm-status fm-status--wait" role="status"><span className="fm-status__dot" /> Waiting for {who}&apos;s device…</p>
			)}
			{expired && (
				<p className="fm-status fm-status--warn" role="status"><Icon name="alert" size={20} /> This code expired. Make a new one.</p>
			)}
			{state.status === "claimed" && !expired && (
				request ? (
					<ApprovalCard
						request={request}
						inPanel
						onDone={(action, r) => {
							onChanged();
							if (action === "approve") setState({ status: "approved", device: { name: r && r.name } });
							else if (action === "deny") setState({ status: "denied" });
						}}
					/>
				) : (
					<p className="fm-status fm-status--wait" role="status"><span className="fm-status__dot" /> A device just joined. Loading the request…</p>
				)
			)}
			{state.status === "approved" && (
				<p className="fm-status fm-status--ok" role="status"><Icon name="check" size={20} /> {state.device && state.device.name ? state.device.name : "The device"} is connected.</p>
			)}
			{state.status === "denied" && <p className="fm-status fm-status--warn" role="status">That device was not approved.</p>}
			{state.status === "cancelled" && <p className="fm-status fm-status--warn" role="status">This code was replaced or cancelled.</p>}

			<div className="fm-pair__actions">
				{state.status === "approved" ? (
					<button type="button" className="fm-btn fm-btn--primary" onClick={onClose}>Done</button>
				) : (
					<>
						<button type="button" className="fm-btn fm-btn--secondary" onClick={() => setNonce((n) => n + 1)} disabled={state.status === "creating"}>New code</button>
						<button type="button" className="fm-btn fm-btn--secondary" onClick={cancel}>Cancel</button>
					</>
				)}
			</div>
		</section>
	);
};

export default PairPanel;
