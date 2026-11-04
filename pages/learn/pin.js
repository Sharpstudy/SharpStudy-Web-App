// Child device: "Grown-ups only". The family PIN is checked by the server (rate limited, with a lockout);
// only then are "switch child", "leave child mode" and "unpair this device" offered.
import React, { useEffect, useState } from "react";
import Head from "next/head";
import Link from "next/link";
import { useRouter } from "next/router";
import { Icon } from "@/components/Family/art";
import { PinPad } from "@/components/Family/controls";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import { device, getDeviceToken, forgetDevice, isDeviceGone, clearLearnerSession } from "@/lib/family/client";
import { getActiveLearner } from "@/lib/mastery-client/api";

const Pin = () => {
	const router = useRouter();
	const [pin, setPin] = useState("");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState(null);
	const [grownup, setGrownup] = useState(null);
	const [confirm, setConfirm] = useState(false);
	const [who, setWho] = useState(null);

	useEffect(() => {
		if (!router.isReady) return;
		if (!getDeviceToken()) router.replace("/learn/join/");
		const a = getActiveLearner();
		setWho(a ? a.displayName : null);
	}, [router]);

	const submit = async () => {
		if (pin.length < 4 || busy) return;
		setBusy(true);
		setError(null);
		try {
			const r = await device.grownup(pin);
			setGrownup(r.grownupToken);
		} catch (e) {
			if (isDeviceGone(e)) {
				forgetDevice();
				return router.replace(`/learn/join/?gone=${encodeURIComponent(e.code)}`);
			}
			setError(e.status === 429 ? "Too many tries. Wait a minute." : e.message);
		} finally {
			setPin("");
			setBusy(false);
		}
	};

	const unpair = async () => {
		setBusy(true);
		try {
			await device.unpair(grownup);
			forgetDevice();
			router.replace("/learn/join/");
		} catch (e) {
			setConfirm(false);
			setError(e.message);
			setGrownup(null);
			setBusy(false);
		}
	};

	return (
		<div className="fm-root fm-root--dark">
			<Head>
				<title>Grown-ups only · Sharp Study</title>
				<meta name="robots" content="noindex" />
			</Head>
			<main className="fm-dark__main" id="main">
				<div className="fm-dark__top">
					<Link href="/learn/"><a className="fm-pill fm-pill--dark">{who ? `Back to ${who}` : "Back"}</a></Link>
				</div>
				<span className="fm-dark__lock" aria-hidden="true"><Icon name="lock" size={34} /></span>
				<h1 className="fm-display fm-display--light fm-dark__title">Grown-ups only</h1>

				{!grownup ? (
					<>
						<p className="fm-dark__sub">Enter your family PIN to leave child mode, switch child, or unpair this device.</p>
						<PinPad theme="dark" value={pin} onChange={setPin} onSubmit={submit} disabled={busy} />
						{error && <p className="fm-error fm-error--dark" role="alert"><Icon name="alert" size={18} /> {error}</p>}
						<button type="button" className="fm-bigbtn fm-bigbtn--inline fm-dark__go" onClick={submit} disabled={pin.length < 4 || busy}>{busy ? "Checking…" : "Unlock"}</button>
						<p className="fm-dark__foot">Forgot it? Reset from your own phone in <strong>Family › Family PIN</strong>.</p>
					</>
				) : (
					<>
						<p className="fm-dark__sub">What would you like to do?</p>
						<div className="fm-dark__actions">
							<button type="button" className="fm-btn fm-btn--dark" onClick={() => { clearLearnerSession(); router.push("/learn/"); }}>Switch child</button>
							<button type="button" className="fm-btn fm-btn--dark" onClick={() => { clearLearnerSession(); router.push("/"); }}>Leave child mode</button>
							<button type="button" className="fm-btn fm-btn--danger-dark" onClick={() => setConfirm(true)}>Unpair this device</button>
						</div>
					</>
				)}
			</main>
			<ConfirmDialog open={confirm} title="Unpair this device?" confirmLabel="Unpair" danger busy={busy} onConfirm={unpair} onCancel={() => setConfirm(false)}>
				<p>It will leave child mode and need a new code from the Family screen to join again. Progress is kept.</p>
			</ConfirmDialog>
		</div>
	);
};

export default Pin;
