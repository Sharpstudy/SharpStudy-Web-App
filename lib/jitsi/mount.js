// Framework-free helpers that put exactly ONE Jitsi meeting into a container.
//
// Why this exists: react-jutsu's effect cleanup is `return () => jitsi && jitsi.dispose()`,
// which closes over the initial `jitsi` state (null), so the meeting is never
// disposed. React 18 StrictMode (reactStrictMode in next.config.js) runs every
// effect twice in development (mount -> cleanup -> mount), so two
// JitsiMeetExternalAPI instances were created in the same container: two
// iframes with the same camera.

// Resolve with window.JitsiMeetExternalAPI once the external API script is available.
export function waitForJitsiApi({ win = window, timeoutMs = 20000, intervalMs = 100, scriptUrl = "https://meet.jit.si/external_api.js" } = {}) {
	return new Promise((resolve, reject) => {
		const started = Date.now();
		let injected = false;
		const tick = () => {
			if (win.JitsiMeetExternalAPI) return resolve(win.JitsiMeetExternalAPI);
			// The page normally loads the script itself; add it only if nobody did.
			if (!injected && !win.document.querySelector(`script[src="${scriptUrl}"]`)) {
				injected = true;
				const s = win.document.createElement("script");
				s.src = scriptUrl;
				s.async = true;
				win.document.head.appendChild(s);
			}
			if (Date.now() - started > timeoutMs) return reject(new Error("The video service could not be loaded. Check your connection and try again."));
			setTimeout(tick, intervalMs);
		};
		tick();
	});
}

// Create the meeting in `container`; returns a dispose function.
// Any content left in the container (a previous meeting) is removed first, so a
// container can never hold more than one meeting.
export function mountJitsi({ container, JitsiAPI, domain = "meet.jit.si", roomName, displayName, onMeetingEnd }) {
	while (container.firstChild) container.removeChild(container.firstChild);
	const client = new JitsiAPI(domain, { roomName, parentNode: container, width: "100%", height: "100%" });
	client.addEventListener("videoConferenceJoined", () => {
		if (displayName) client.executeCommand("displayName", displayName);
	});
	if (onMeetingEnd) client.addEventListener("readyToClose", onMeetingEnd);
	let disposed = false;
	return () => {
		if (disposed) return;
		disposed = true;
		try {
			client.dispose();
		} finally {
			while (container.firstChild) container.removeChild(container.firstChild);
		}
	};
}
