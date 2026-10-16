import React, { useEffect, useRef, useState } from "react";
import { waitForJitsiApi, mountJitsi } from "@/lib/jitsi/mount";

// The one Jitsi meeting of the live class (same domain, room and display name as
// before). It owns exactly one JitsiMeetExternalAPI instance and disposes it on
// unmount, which also makes it safe under React 18 StrictMode's double effects.
const JitsiMeeting = ({ roomName, displayName, domain = "meet.jit.si", onMeetingEnd }) => {
	const containerRef = useRef(null);
	const endRef = useRef(onMeetingEnd);
	const [state, setState] = useState("loading"); // loading | ready | error
	const [error, setError] = useState("");

	useEffect(() => {
		endRef.current = onMeetingEnd;
	}, [onMeetingEnd]);

	useEffect(() => {
		let cancelled = false;
		let dispose = null;
		setState("loading");
		waitForJitsiApi({ scriptUrl: `https://${domain}/external_api.js` })
			.then((JitsiAPI) => {
				// Unmounted (or StrictMode's first, discarded run) before the script was ready: do nothing.
				if (cancelled || !containerRef.current) return;
				dispose = mountJitsi({
					container: containerRef.current,
					JitsiAPI,
					domain,
					roomName,
					displayName,
					onMeetingEnd: () => endRef.current && endRef.current(),
				});
				setState("ready");
			})
			.catch((e) => {
				if (cancelled) return;
				setError(e.message);
				setState("error");
			});
		return () => {
			cancelled = true;
			if (dispose) dispose();
		};
	}, [roomName, displayName, domain]);

	return (
		<div className="ss-jitsi">
			{state === "loading" && <p className="ss-muted ss-jitsi__status">Connecting to the class…</p>}
			{state === "error" && (
				<p className="ss-jitsi__status" role="alert">
					{error}
				</p>
			)}
			<div ref={containerRef} className="ss-jitsi__frame" data-jitsi-container />
		</div>
	);
};

export default JitsiMeeting;
