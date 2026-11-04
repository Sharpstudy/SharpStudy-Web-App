// Floating "Feedback" button with an optional page screenshot
// (html-to-image, already a project dependency). Sends to /api/mastery/feedback.
import React, { useEffect, useRef, useState } from "react";
import { useRouter } from "next/router";
import { api } from "@/lib/mastery-client/api";

const MAX_SCREENSHOT_BYTES = 1500000;

const FeedbackButton = () => {
	const router = useRouter();
	const [open, setOpen] = useState(false);
	const [message, setMessage] = useState("");
	const [shot, setShot] = useState(null);
	const [busy, setBusy] = useState(false);
	const [status, setStatus] = useState(null);
	const dialogRef = useRef(null);

	useEffect(() => {
		if (!open) return;
		const onKey = (e) => e.key === "Escape" && setOpen(false);
		document.addEventListener("keydown", onKey);
		if (dialogRef.current) dialogRef.current.querySelector("textarea").focus();
		return () => document.removeEventListener("keydown", onKey);
	}, [open]);

	const capture = async () => {
		setBusy(true);
		setStatus(null);
		try {
			const { toJpeg } = await import("html-to-image");
			const dataUrl = await toJpeg(document.querySelector("main") || document.body, {
				quality: 0.6,
				pixelRatio: 1,
				filter: (node) => !(node.classList && node.classList.contains("ml-feedback")),
			});
			if (dataUrl.length > MAX_SCREENSHOT_BYTES) setStatus({ tone: "warning", text: "The screenshot is too large to attach." });
			else setShot(dataUrl);
		} catch (e) {
			setStatus({ tone: "warning", text: "Could not capture a screenshot on this page." });
		} finally {
			setBusy(false);
		}
	};

	const send = async (e) => {
		e.preventDefault();
		if (!message.trim()) return;
		setBusy(true);
		try {
			await api.post("/feedback", { message: message.trim(), page: router.asPath.slice(0, 200), screenshot: shot });
			setStatus({ tone: "success", text: "Thank you! Your feedback was sent." });
			setMessage("");
			setShot(null);
		} catch (err) {
			setStatus({ tone: "danger", text: err.message });
		} finally {
			setBusy(false);
		}
	};

	return (
		<div className="ml-feedback">
			<button type="button" className="ml-feedback__toggle" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
				<i className="ri-feedback-line" aria-hidden="true"></i>
				<span>Feedback</span>
			</button>
			{open && (
				<div className="ml-feedback__panel ss-card" role="dialog" aria-modal="false" aria-labelledby="ml-feedback-title" ref={dialogRef}>
					<form onSubmit={send}>
						<h2 id="ml-feedback-title" className="ml-h3">
							Send feedback
						</h2>
						<label htmlFor="ml-feedback-msg" className="ml-label-text">
							What happened, or what could be better?
						</label>
						<textarea id="ml-feedback-msg" className="ml-textarea" rows={4} maxLength={4000} value={message} onChange={(e) => setMessage(e.target.value)} required />
						<div className="ml-row">
							<button type="button" className="ss-btn ss-btn--secondary ss-btn--sm" onClick={capture} disabled={busy}>
								<i className="ri-screenshot-2-line" aria-hidden="true"></i> {shot ? "Retake screenshot" : "Attach screenshot"}
							</button>
							{shot && (
								<button type="button" className="ss-btn ss-btn--ghost ss-btn--sm" onClick={() => setShot(null)}>
									Remove
								</button>
							)}
						</div>
						{shot && (
							// eslint-disable-next-line @next/next/no-img-element
							<img src={shot} alt="Screenshot preview" className="ml-feedback__preview" />
						)}
						{status && (
							<p className={`ml-note ml-note--${status.tone}`} role="status">
								{status.text}
							</p>
						)}
						<div className="ml-row ml-row--end">
							<button type="button" className="ss-btn ss-btn--ghost ss-btn--sm" onClick={() => setOpen(false)}>
								Close
							</button>
							<button type="submit" className="ss-btn ss-btn--sm" disabled={busy || !message.trim()}>
								Send
							</button>
						</div>
					</form>
				</div>
			)}
		</div>
	);
};

export default FeedbackButton;
