// Child device home: who's learning -> (3 secret pictures) -> learning journey.
// The device is re-checked with the server on a timer, so a device the parent revoked drops back to the
// join screen within moments, and its learner session stops working immediately (see lib/family).
import React, { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/router";
import { ChildFrame, Picker, PictureLogin, ChildHome } from "@/components/Family/ChildScreens";
import { device, getDeviceToken, forgetDevice, isDeviceGone, setLearnerToken } from "@/lib/family/client";
import { api, getActiveLearner, getLearnerToken } from "@/lib/mastery-client/api";

const Learn = () => {
	const router = useRouter();
	const [phase, setPhase] = useState("loading"); // loading | picker | picture | home | offline
	const [learners, setLearners] = useState([]);
	const [chosen, setChosen] = useState(null);
	const [picks, setPicks] = useState([]);
	const [active, setActive] = useState(null);
	const [home, setHome] = useState(null);
	const [homeError, setHomeError] = useState(null);
	const [error, setError] = useState(null);
	const [lockedText, setLockedText] = useState(null);
	const [busy, setBusy] = useState(false);
	const [connected, setConnected] = useState(true);
	const alive = useRef(true);
	const leaving = useRef(false);

	const leaveGone = useCallback(
		(e) => {
			if (leaving.current) return; // overlapping checks must not start two navigations
			leaving.current = true;
			forgetDevice();
			router.replace(`/learn/join/?gone=${encodeURIComponent(e.code)}`);
		},
		[router]
	);

	// Ask the server about this device; decide which screen to show.
	const check = useCallback(async () => {
		if (!getDeviceToken()) return router.replace("/learn/join/");
		try {
			const s = await device.status();
			if (!alive.current) return;
			setConnected(true);
			if (s.status !== "approved") return router.replace("/learn/join/");
			setLearners(s.learners);
			const me = getActiveLearner();
			const mine = me && getLearnerToken() && s.learners.find((l) => l.id === me.id);
			if (mine) {
				setActive((cur) => cur || { id: me.id, displayName: me.displayName, avatar: me.avatar });
				setPhase((p) => (p === "loading" || p === "picker" || p === "offline" ? "home" : p));
			} else {
				if (getLearnerToken()) setLearnerToken(null); // a session from before, for a child no longer here
				setActive(null);
				setPhase((p) => (p === "picture" ? p : "picker"));
			}
		} catch (e) {
			if (!alive.current) return;
			if (isDeviceGone(e)) return leaveGone(e);
			setConnected(false);
			setPhase((p) => (p === "loading" ? "offline" : p));
		}
	}, [router, leaveGone]);

	useEffect(() => {
		alive.current = true;
		if (!router.isReady) return;
		check();
		const t = setInterval(() => !document.hidden && check(), 20000);
		return () => {
			alive.current = false;
			clearInterval(t);
		};
	}, [router.isReady, check]);

	const loadHome = useCallback(async () => {
		setHomeError(null);
		try {
			setHome(await api.get("/study/home", { account: false }));
		} catch (e) {
			if (e.status === 401) {
				// The child's session is no longer valid (device removed, or the child left this family).
				setLearnerToken(null);
				setActive(null);
				setHome(null);
				check();
			} else setHomeError(e.message);
		}
	}, [check]);
	useEffect(() => {
		if (phase === "home") loadHome();
	}, [phase, loadHome]);

	const start = async (l, pic) => {
		setBusy(true);
		setError(null);
		try {
			const r = await device.session({ learnerId: l.id, ...(pic ? { picture: pic } : {}) });
			setLearnerToken(r.learnerToken, r.learner, null);
			setActive({ id: r.learner.id, displayName: r.learner.displayName, avatar: r.learner.avatar });
			setChosen(null);
			setPicks([]);
			setPhase("home");
		} catch (e) {
			if (isDeviceGone(e)) return leaveGone(e);
			if (e.status === 423) setLockedText(e.message);
			else setError(e.message);
			setPicks([]);
		} finally {
			setBusy(false);
		}
	};

	const pick = (l) => {
		setError(null);
		setLockedText(null);
		setPicks([]);
		if (l.pictureRequired) {
			setChosen(l);
			setPhase("picture");
		} else {
			start(l);
		}
	};

	// Third picture tapped: sign in.
	useEffect(() => {
		if (phase === "picture" && chosen && picks.length === 3 && !busy) start(chosen, picks);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [picks]);

	if (phase === "loading") return <ChildFrame title="Sharp Study"><p className="fm-child__sub fm-center" role="status">One moment…</p></ChildFrame>;
	if (phase === "offline") {
		return (
			<ChildFrame title="Sharp Study">
				<div className="fm-center-screen">
					<h1 className="fm-display fm-display--lg">We can&apos;t reach Sharp Study</h1>
					<p className="fm-child__sub">Check the internet, then try again.</p>
					<button type="button" className="fm-bigbtn fm-bigbtn--inline" onClick={check}>Try again</button>
				</div>
			</ChildFrame>
		);
	}
	if (phase === "picture" && chosen) {
		return (
			<ChildFrame title="Secret pictures">
				<PictureLogin learner={chosen} picks={picks} setPicks={setPicks} busy={busy} error={error} lockedText={lockedText} onNotMe={() => { setChosen(null); setPicks([]); setError(null); setLockedText(null); setPhase("picker"); }} />
			</ChildFrame>
		);
	}
	if (phase === "home" && active) {
		return (
			<ChildFrame title={`Hi ${active.displayName}`}>
				<ChildHome learner={active} home={home} error={homeError} onRetry={loadHome} connected={connected} />
			</ChildFrame>
		);
	}
	return (
		<ChildFrame title="Who's learning?">
			<Picker learners={learners} onPick={pick} busyId={busy ? "x" : null} error={error} />
		</ChildFrame>
	);
};

export default Learn;
