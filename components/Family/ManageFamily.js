// The Family hub (reference: "Family"): linked children with their paired devices, pairing, family PIN.
// All data is the server's: devices appear after approval, disappear after revocation, and every button
// calls the API and reports its real result.
import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/router";
import { Avatar, Icon } from "./art";
import { LinkChildForm, PictureCodeForm, ageLabel } from "./LinkChild";
import Dialog from "./Dialog";
import { PinPad } from "./controls";
import PairPanel, { ApprovalSheet } from "./PairDevice";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import { parent } from "@/lib/family/client";
import { PARENT_HOME } from "@/lib/family/parentMode";

const useWide = (query = "(min-width: 900px)") => {
	const [wide, setWide] = useState(false);
	useEffect(() => {
		const m = window.matchMedia(query);
		const on = () => setWide(m.matches);
		on();
		m.addEventListener ? m.addEventListener("change", on) : m.addListener(on);
		return () => (m.removeEventListener ? m.removeEventListener("change", on) : m.removeListener(on));
	}, [query]);
	return wide;
};

const seenLabel = (d) => {
	if (d.online) return null;
	if (!d.lastSeenAt) return "Not connected yet";
	const days = Math.floor((Date.now() - new Date(d.lastSeenAt).getTime()) / 86400000);
	return days <= 0 ? "Last seen today" : days === 1 ? "Last seen yesterday" : `Last seen ${days} days ago`;
};

const deviceIcon = (label) => (/iPad|tablet/i.test(label) ? "tablet" : /PC|Mac|Chromebook|Linux/i.test(label) ? "laptop" : "phone");

// ------------------------------------------------------------------ dialogs
const ChangePinDialog = ({ open, onClose, pinSet, onSaved }) => {
	const [method, setMethod] = useState("pin");
	const [proof, setProof] = useState("");
	const [pin, setPin] = useState("");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState(null);

	useEffect(() => {
		if (open) {
			setMethod("pin");
			setProof("");
			setPin("");
			setError(null);
		}
	}, [open]);

	const save = async () => {
		setError(null);
		if (pin.length < 4) return setError("Use 4 to 6 digits.");
		if (pinSet && !proof) return setError(method === "pin" ? "Enter your current PIN." : "Enter your account password.");
		setBusy(true);
		try {
			await parent.setPin({ pin, ...(pinSet ? (method === "pin" ? { currentPin: proof } : { password: proof }) : {}) });
			onSaved();
			onClose();
		} catch (e) {
			setError(e.message);
			setPin("");
		} finally {
			setBusy(false);
		}
	};

	return (
		<Dialog open={open} onClose={onClose} title={pinSet ? "Change family PIN" : "Set a family PIN"}>
			<div className="fm-form">
				{pinSet && (
					<div className="fm-field">
						<div className="fm-seg" role="radiogroup" aria-label="Prove it's you">
							<button type="button" role="radio" aria-checked={method === "pin"} className={method === "pin" ? "is-on" : ""} onClick={() => { setMethod("pin"); setProof(""); }}>Current PIN</button>
							<button type="button" role="radio" aria-checked={method === "password"} className={method === "password" ? "is-on" : ""} onClick={() => { setMethod("password"); setProof(""); }}>Account password</button>
						</div>
						<label className="fm-label" htmlFor="fm-proof">{method === "pin" ? "Current PIN" : "Account password"}</label>
						<input id="fm-proof" className="fm-input" type="password" autoComplete={method === "pin" ? "off" : "current-password"} inputMode={method === "pin" ? "numeric" : "text"} maxLength={method === "pin" ? 6 : 128} value={proof} onChange={(e) => setProof(method === "pin" ? e.target.value.replace(/\D/g, "") : e.target.value)} />
						<p className="fm-muted">Forgot the PIN? Use your account password.</p>
					</div>
				)}
				<p className="fm-label">New PIN</p>
				<PinPad value={pin} onChange={setPin} onSubmit={save} disabled={busy} />
				<p className="fm-muted fm-center">4 to 6 digits · avoid birthdays</p>
				{error && <p className="fm-error" role="alert"><Icon name="alert" size={18} /> {error}</p>}
				<div className="fm-form__actions">
					<button type="button" className="fm-btn fm-btn--ghost" onClick={onClose} disabled={busy}>Cancel</button>
					<button type="button" className="fm-btn fm-btn--primary" onClick={save} disabled={busy || pin.length < 4}>{busy ? "Saving…" : "Save PIN"}</button>
				</div>
			</div>
		</Dialog>
	);
};

const LinkDialog = ({ open, onClose, onLinked }) => (
	<Dialog open={open} onClose={onClose} title="Link my child">
		{open && <LinkChildForm idPrefix="fm-mlink" onCancel={onClose} onLinked={onLinked} />}
	</Dialog>
);

// ------------------------------------------------------------------ page
const ManageFamily = () => {
	const router = useRouter();
	const wide = useWide();
	const [data, setData] = useState(null);
	const [error, setError] = useState(null);
	const [pairing, setPairing] = useState(null); // { ids }
	const [editing, setEditing] = useState(null);
	const [linkOpen, setLinkOpen] = useState(false);
	const [pinOpen, setPinOpen] = useState(false);
	const [revoke, setRevoke] = useState(null);
	const [revokeBusy, setRevokeBusy] = useState(false);
	const [notice, setNotice] = useState(null);

	const load = useCallback(async () => {
		try {
			setData(await parent.family());
			setError(null);
		} catch (e) {
			setError(e);
		}
	}, []);
	useEffect(() => {
		load();
		const t = setInterval(() => !document.hidden && load(), 5000);
		return () => clearInterval(t);
	}, [load]);

	if (error && !data) {
		return (
			<div className="fm-card" role="alert">
				<p className="fm-error"><Icon name="alert" size={18} /> {error.message}</p>
				<button type="button" className="fm-btn fm-btn--secondary" onClick={load}>Try again</button>
			</div>
		);
	}
	if (!data) return <p className="fm-muted" role="status">Loading your family…</p>;

	const kids = data.children;
	const doRevoke = async () => {
		setRevokeBusy(true);
		try {
			await parent.revoke(revoke.device.id);
			setNotice(`${revoke.device.name || revoke.device.label} was removed.`);
			setRevoke(null);
			await load();
		} catch (e) {
			setNotice(e.message);
			setRevoke(null);
		} finally {
			setRevokeBusy(false);
		}
	};

	const startPairing = (id) => setPairing({ ids: [id], key: Date.now() });
	const pendingRequest = !pairing && data.requests[0];

	const list = (
		<div className="fm-family__list">
			{notice && <p className="fm-note fm-note--ok" role="status"><Icon name="check" size={18} /> {notice}</p>}
			{kids.length === 0 && (
				<div className="fm-card fm-empty">
					<h2 className="fm-h3">No children linked yet</h2>
					<p className="fm-muted">Your child&apos;s instructor creates their learner profile. Your child then shows you a link code from their own SharpStudy account.</p>
					<Link href="/family/setup/"><a className="fm-btn fm-btn--primary">Link your child</a></Link>
				</div>
			)}
			{kids.map((k) => (
				<article key={k.id} className={`fm-card fm-child ${pairing && pairing.ids.includes(k.id) ? "is-selected" : ""}`} aria-labelledby={`kid-${k.id}`}>
					<div className="fm-child__head">
						<Avatar avatar={k.avatar} size={54} />
						<div className="fm-child__who">
							<h2 className="fm-h3" id={`kid-${k.id}`}>{k.nickname}</h2>
							<p className="fm-muted">
								{k.ageBand ? `Ages ${ageLabel(k.ageBand)}` : "Age not set"}
								{k.pictureCode ? " · Picture code on" : ""}
								{!k.devices.length && wide ? " · No device yet" : ""}
							</p>
						</div>
						<button type="button" className="fm-linkbtn" onClick={() => setEditing(k)} aria-label={`Picture code for ${k.nickname}`}>Picture code</button>
					</div>
					{k.devices.map((d) => (
						<div key={d.id} className="fm-device">
							<Icon name={deviceIcon(d.label)} size={24} />
							<div className="fm-device__who">
								<strong>{d.name || d.label}</strong>
								{d.shared && <span className="fm-muted"> · shared</span>}
								<span className={`fm-device__seen ${d.online ? "is-online" : ""}`}>{d.online ? <><span className="fm-dot" aria-hidden="true" /> Online now</> : seenLabel(d)}</span>
							</div>
							<button type="button" className="fm-btn fm-btn--danger-outline fm-btn--sm" onClick={() => setRevoke({ device: d, child: k })} aria-label={`Revoke ${d.name || d.label}`}>Revoke</button>
						</div>
					))}
					{(k.devices.length > 0 || !wide) ? (
						<button type="button" className="fm-dashed" onClick={() => startPairing(k.id)}>
							<Icon name="plus" size={18} /> Pair a device
						</button>
					) : (
						<button type="button" className="fm-btn fm-btn--secondary fm-btn--sm fm-child__pair" onClick={() => startPairing(k.id)}>Pair a device</button>
					)}
				</article>
			))}

			<div className="fm-card fm-rows">
				<button type="button" className="fm-row" onClick={() => setPinOpen(true)}>
					<Icon name="lock" size={22} />
					<span className="fm-row__label">Family PIN</span>
					<span className="fm-row__hint">{data.pinSet ? "Change" : "Set up"}</span>
				</button>
				<button type="button" className="fm-row" onClick={() => setLinkOpen(true)}>
					<Icon name="userPlus" size={22} />
					<span className="fm-row__label">Link my child</span>
					<span className="fm-row__hint">With a code</span>
				</button>
			</div>
		</div>
	);

	const panel = pairing && (
		<PairPanel
			key={pairing.key}
			kids={kids}
			initialIds={pairing.ids}
			requests={data.requests}
			onChanged={load}
			onClose={() => { setPairing(null); load(); }}
			variant={wide ? "panel" : "page"}
		/>
	);

	return (
		<>
			{!(pairing && !wide) && (
				<header className="fm-pagehead">
					<h1 className="fm-h1">Family</h1>
					</header>
			)}
			{pairing && !wide ? panel : (
				<div className={`fm-family ${pairing ? "has-panel" : ""}`}>
					{list}
					{panel}
				</div>
			)}

			<Dialog open={!!editing} onClose={() => setEditing(null)} title={editing ? `Picture code for ${editing.nickname}` : ""}>
				{editing && <PictureCodeForm key={editing.id} child={editing} onCancel={() => setEditing(null)} onSaved={() => { setEditing(null); setNotice("Picture code saved."); load(); }} idPrefix="fm-edit" />}
			</Dialog>
			<ChangePinDialog open={pinOpen} onClose={() => setPinOpen(false)} pinSet={data.pinSet} onSaved={() => { setNotice("Family PIN saved."); load(); }} />
			<LinkDialog open={linkOpen} onClose={() => setLinkOpen(false)} onLinked={() => { setLinkOpen(false); router.push(PARENT_HOME); }} />
			<ConfirmDialog
				open={!!revoke}
				title={revoke ? `Remove ${revoke.device.name || revoke.device.label}?` : ""}
				confirmLabel="Revoke"
				danger
				busy={revokeBusy}
				onConfirm={doRevoke}
				onCancel={() => setRevoke(null)}
			>
				<p>It will leave child mode at once and needs a new code to join again. {revoke ? `${revoke.child.nickname}'s progress is kept.` : ""}</p>
			</ConfirmDialog>
			{pendingRequest && <ApprovalSheet key={pendingRequest.id} request={pendingRequest} onDone={load} />}
		</>
	);
};

export default ManageFamily;
