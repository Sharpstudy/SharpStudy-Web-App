// Child side of parent linking, shown on the signed-in child's own student Family page (/family/). The child clicks "Show parent link
// code" and reads the code to their parent. The code exists only in this component's memory: the server keeps just
// its hash, so it cannot be shown again after the page is left (the child makes a new one, which replaces the old).
// It never goes through a URL. Renders nothing for accounts without a learner profile.
import React, { useCallback, useEffect, useState } from "react";
import { childLinks } from "@/lib/family/client";

const fmt = (d) => new Date(d).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

const ParentLinkCode = () => {
	const [status, setStatus] = useState(null); // { eligible, openCode, parents }
	const [shown, setShown] = useState(null); // { display, expiresAt }; in memory only
	const [copied, setCopied] = useState(false);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState(null);
	const load = useCallback(() => childLinks.status().then(setStatus).catch(() => {}), []);
	useEffect(() => {
		load();
	}, [load]);

	if (!status || !status.eligible) return null; // not signed in as a child account with a learner profile: nothing to show

	const show = async () => {
		if (busy) return;
		setBusy(true);
		setError(null);
		try {
			const c = await childLinks.show();
			setShown({ display: c.display, expiresAt: c.expiresAt });
			setCopied(false);
			await load();
		} catch (e) {
			setError(e.message);
		} finally {
			setBusy(false);
		}
	};
	const cancel = async () => {
		if (busy) return;
		setBusy(true);
		setError(null);
		try {
			await childLinks.cancel();
			setShown(null);
			await load();
		} catch (e) {
			setError(e.message);
		} finally {
			setBusy(false);
		}
	};
	const copy = async () => {
		try {
			await navigator.clipboard.writeText(shown.display);
			setCopied(true);
		} catch (e) {
			setError("Copy is not available here. Select the code and copy it by hand.");
		}
	};

	return (
		<>
			<section className="ml-card ml-stack" aria-labelledby="plc-title" data-testid="parent-link-code">
				<h2 id="plc-title" className="ml-h3">Link my parent</h2>
				<p className="ml-muted ml-small">
					Want your parent or guardian to follow your learning? Show a code and read it to them. Only give it to your own parent or guardian. A code works <strong>once</strong> and
					expires <strong>72 hours</strong> after you create it.
				</p>
				{shown && (
					<p>
						<strong style={{ fontSize: "1.4em", letterSpacing: "0.12em" }}>{shown.display}</strong>{" "}
						<button type="button" className="ss-btn ss-btn--ghost ss-btn--sm" onClick={copy}>{copied ? "Copied" : "Copy"}</button>
					</p>
				)}
				{shown && <p className="ml-small">Expires {fmt(shown.expiresAt)} (72 hours from now). Write it down or copy it now: it cannot be shown again, but you can make a new one (the old one then stops working).</p>}
				{!shown && status.openCode && <p className="ml-small">A code you made earlier is still open until {fmt(status.openCode.expiresAt)}. It cannot be shown again; make a new one if needed.</p>}
				<ol className="ml-small ml-muted">
					<li>Select <em>Show parent link code</em> and read the code to your parent or guardian.</li>
					<li>They sign in on SharpStudy, open <em>Family</em>, choose <em>Link my child</em> and type the code.</li>
				</ol>
				<p>
					<button type="button" className="ss-btn ss-btn--sm" onClick={show} disabled={busy}>{shown || status.openCode ? "Make a new code" : "Show parent link code"}</button>{" "}
					{status.openCode && <button type="button" className="ss-btn ss-btn--ghost ss-btn--sm" onClick={cancel} disabled={busy}>Cancel code</button>}
				</p>
				{error && <p className="ml-note ml-note--danger" role="alert">{error}</p>}
			</section>
			<section className="ml-card ml-stack" aria-labelledby="plc-parents" data-testid="linked-parents">
				<h2 id="plc-parents" className="ml-h3">Linked parents</h2>
				{status.parents.length > 0 ? (
					<>
						<ul>
							{status.parents.map((p, i) => <li key={i}>{p.name}</li>)}
						</ul>
						<p className="ml-small ml-muted">If you do not recognise someone, tell your instructor.</p>
					</>
				) : (
					<p className="ml-muted ml-small">No parent or guardian is linked yet. Once they enter your code, their name appears here.</p>
				)}
			</section>
		</>
	);
};

export default ParentLinkCode;
