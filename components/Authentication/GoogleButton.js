import React from "react";
import axios from "axios";
import toast from "react-hot-toast";
import { useRouter } from "next/router";
import { handleLogin } from "@/utils/auth";
import baseUrl from "@/utils/baseUrl";

// "Continue with Google" (Google Identity Services). Google shows its own account chooser and returns a signed ID token (`credential`)
// for OUR client id; the only thing sent to the server is that token, which /api/users/google verifies. Nothing about the person or
// their role is decided here.
// Needs NEXT_PUBLIC_GOOGLE_CLIENT_ID (the same value as the server's GOOGLE_CLIENT_ID). Without it the button is simply not shown.
const CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
const SRC = "https://accounts.google.com/gsi/client";

const loadScript = () =>
	new Promise((resolve, reject) => {
		if (typeof window === "undefined") return reject(new Error("no window"));
		if (window.google && window.google.accounts && window.google.accounts.id) return resolve();
		let s = document.querySelector(`script[src="${SRC}"]`);
		if (!s) {
			s = document.createElement("script");
			s.src = SRC;
			s.async = true;
			s.defer = true;
			document.head.appendChild(s);
		}
		s.addEventListener("load", () => resolve());
		s.addEventListener("error", () => reject(new Error("blocked")));
	});

const GoogleButton = ({ fallback = "/" }) => {
	const router = useRouter();
	const holder = React.useRef(null);
	const [state, setState] = React.useState(CLIENT_ID ? "loading" : "off"); // loading | ready | failed | off
	const [busy, setBusy] = React.useState(false);

	React.useEffect(() => {
		if (!CLIENT_ID) return undefined;
		let cancelled = false;
		loadScript()
			.then(() => {
				if (cancelled || !holder.current) return;
				window.google.accounts.id.initialize({
					client_id: CLIENT_ID,
					callback: async ({ credential }) => {
						try {
							setBusy(true);
							const res = await axios.post(`${baseUrl}/api/users/google`, { credential });
							handleLogin(res.data.edmy_users_token, router, fallback);
						} catch (err) {
							toast.error(err?.response?.data?.message || "Could not sign in with Google right now, please try again.");
							setBusy(false);
						}
					},
					ux_mode: "popup",
					auto_select: false,
				});
				window.google.accounts.id.renderButton(holder.current, { type: "standard", theme: "outline", size: "large", text: "continue_with", shape: "rectangular", logo_alignment: "left", width: holder.current.offsetWidth || 320 });
				setState("ready");
			})
			.catch(() => !cancelled && setState("failed"));
		return () => {
			cancelled = true;
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	if (state === "off") return null;
	return (
		<div className="ss-google" aria-busy={busy || undefined}>
			<div ref={holder} className="ss-google__btn" style={{ minHeight: 44, opacity: busy ? 0.5 : 1, pointerEvents: busy ? "none" : "auto" }} />
			{state === "failed" && <p className="ss-muted ss-google__note">Google sign-in could not load (it may be blocked in this browser). You can still continue with email.</p>}
			<div className="ss-or" role="separator" aria-label="or"><span>or continue with email</span></div>
		</div>
	);
};

export default GoogleButton;
