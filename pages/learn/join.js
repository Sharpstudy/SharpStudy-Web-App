// Child device: type (or scan) the code from the grown-up's screen, wait for approval, then go.
// "Waiting" and "You're in" only ever follow what the server reports about THIS device.
import React, { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/router";
import { ChildFrame, WaitingScreen, SuccessScreen, GONE_TEXT } from "@/components/Family/ChildScreens";
import { CodeBoxes, cleanCodeInput } from "@/components/Family/controls";
import { Icon } from "@/components/Family/art";
import { device, getDeviceToken, setDeviceToken, forgetDevice, isDeviceGone } from "@/lib/family/client";

const Join = () => {
	const router = useRouter();
	const [phase, setPhase] = useState("checking"); // checking | code | waiting | success
	const [code, setCode] = useState("");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState(null);
	const [learners, setLearners] = useState([]);
	const started = useRef(false);

	const gone = useCallback((e) => {
		forgetDevice();
		setError(GONE_TEXT[e.code] || GONE_TEXT.device_invalid);
		setPhase("code");
	}, []);

	// First load: a code in the link only pre-fills (a link preview must never use up a code); an existing device resumes.
	useEffect(() => {
		if (!router.isReady || started.current) return;
		started.current = true;
		const fromLink = cleanCodeInput(router.query.code);
		if (fromLink) {
			setCode(fromLink);
			router.replace("/learn/join/", undefined, { shallow: true }); // do not leave the code in the address bar/history
		}
		if (router.query.gone && GONE_TEXT[router.query.gone]) setError(GONE_TEXT[router.query.gone]);
		if (!getDeviceToken()) return setPhase("code");
		device
			.status()
			.then((s) => {
				if (s.status === "approved") router.replace("/learn/");
				else {
					setLearners(s.learners);
					setPhase("waiting");
				}
			})
			.catch((e) => (isDeviceGone(e) ? gone(e) : setPhase("code")));
	}, [router, gone]);

	// While waiting: ask the server every couple of seconds.
	useEffect(() => {
		if (phase !== "waiting") return;
		let alive = true;
		const t = setInterval(async () => {
			try {
				const s = await device.status();
				if (!alive) return;
				if (s.status === "approved") {
					setLearners(s.learners);
					setPhase("success");
				}
			} catch (e) {
				if (alive && isDeviceGone(e)) gone(e);
			}
		}, 2500);
		return () => {
			alive = false;
			clearInterval(t);
		};
	}, [phase, gone]);

	const join = async () => {
		if (code.length !== 6 || busy) return;
		setBusy(true);
		setError(null);
		try {
			const r = await device.join(code);
			setDeviceToken(r.deviceToken);
			setLearners(r.learners);
			setCode("");
			setPhase("waiting");
		} catch (e) {
			setError(e.status === 429 ? "Too many tries. Wait a minute, then try again." : e.message);
		} finally {
			setBusy(false);
		}
	};

	const startOver = () => {
		forgetDevice();
		setLearners([]);
		setError(null);
		setCode("");
		setPhase("code");
	};

	if (phase === "checking") return <ChildFrame title="Join your family"><p className="fm-child__sub fm-center" role="status">One moment…</p></ChildFrame>;
	if (phase === "waiting") return <ChildFrame title="Waiting for your grown-up"><WaitingScreen learners={learners} onStartOver={startOver} /></ChildFrame>;
	if (phase === "success") {
		return (
			<ChildFrame title="You're in" tone="blue">
				<SuccessScreen learners={learners} onGo={() => router.push("/learn/")} />
			</ChildFrame>
		);
	}

	return (
		<ChildFrame title="Join your family" decor brand>
			<form className="fm-join" onSubmit={(e) => { e.preventDefault(); join(); }}>
				<h1 className="fm-display fm-display--xl fm-join__title">
					<span className="fm-join__hi">Hi there!<br /></span>
					Let&apos;s join your family<span className="fm-m-only">.</span><span className="fm-d-only">!</span>
				</h1>
				<p className="fm-child__sub fm-join__sub">
					Type the code from your grown-up&apos;s <span className="fm-m-only">phone</span><span className="fm-d-only">screen</span>.
				</p>
				<label className="fm-join__label" htmlFor="fm-code">Secret code</label>
				<CodeBoxes value={code} onChange={setCode} onEnter={join} disabled={busy} autoFocus invalid={!!error} />
				<p className="fm-join__hint fm-m-only">Letters and numbers. No O or I — so no mix-ups!</p>
				{error && (
					<p className="fm-error fm-error--child" role="alert">
						<Icon name="alert" size={20} /> {error}
					</p>
				)}
				<button type="submit" className="fm-bigbtn" disabled={code.length !== 6 || busy}>{busy ? "Joining…" : "Join"}</button>
			</form>
			<aside className="fm-join__note">
				<Icon name="qr" size={26} />
				<p className="fm-m-only"><strong>Grown-ups:</strong> you can also scan the QR on your screen with this device&apos;s camera app.</p>
				<p className="fm-d-only"><strong>Grown-ups:</strong> this computer stays in child mode after pairing. Leaving it needs your family PIN.</p>
			</aside>
		</ChildFrame>
	);
};

export default Join;
