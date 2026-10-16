// Sage help panel in the worksheet player: replay lesson, explain with
// different numbers, worked similar example, and (if an admin enabled it)
// a short Socratic chat. Every use is recorded server-side as a hint.
import React, { useEffect, useState } from "react";
import { api } from "@/lib/mastery-client/api";
import QuestionView from "./QuestionView";

let capsCache = null;

const TutorPanel = ({ startToken, questionIndex, attempted, tries, lesson }) => {
	const [open, setOpen] = useState(false);
	const [caps, setCaps] = useState(capsCache);
	const [reply, setReply] = useState(null);
	const [busy, setBusy] = useState(false);
	const [message, setMessage] = useState("");
	const [error, setError] = useState(null);

	useEffect(() => {
		setReply(null);
		setError(null);
		setMessage("");
	}, [questionIndex]);

	useEffect(() => {
		if (!open || caps) return;
		api
			.get("/tutor")
			.then((c) => {
				capsCache = c;
				setCaps(c);
			})
			.catch(() => setCaps({ enabled: true, chatEnabled: false, aiAvailable: false }));
	}, [open, caps]);

	const ask = async (mode) => {
		setBusy(true);
		setError(null);
		try {
			const r = await api.post("/tutor", { startToken, questionIndex, mode, attempted, message: mode === "chat" ? message : undefined });
			setReply(r);
			if (mode === "chat") setMessage("");
		} catch (e) {
			// Friendly offline / outage fallback: the lesson is already on the device.
			setReply({ mode: "replay", text: e.status === 0 ? `Sage needs the internet for that. Here is the lesson: ${lesson}` : e.message });
			if (e.status && e.status !== 0) setError(e.message);
		} finally {
			setBusy(false);
		}
	};

	return (
		<aside className={`ml-tutor${open ? " is-open" : ""}`} aria-label="Sage, your tutor">
			<button type="button" className="ml-tutor__toggle" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
				<span aria-hidden="true">🦉</span> {open ? "Hide help" : tries >= 2 ? "Stuck? Ask Sage" : "Ask Sage for help"}
			</button>
			{open && (
				<div className="ml-tutor__body">
					{caps && !caps.enabled ? (
						<p className="ml-muted">Sage is switched off. Here is the lesson: {lesson}</p>
					) : (
						<>
							<div className="ml-row ml-row--wrap">
								<button type="button" className="ss-btn ss-btn--secondary ss-btn--sm" disabled={busy} onClick={() => ask("replay")}>
									<i className="ri-replay-line" aria-hidden="true"></i> Replay lesson
								</button>
								<button type="button" className="ss-btn ss-btn--secondary ss-btn--sm" disabled={busy} onClick={() => ask("explain")}>
									<i className="ri-lightbulb-line" aria-hidden="true"></i> Explain the method
								</button>
								<button type="button" className="ss-btn ss-btn--secondary ss-btn--sm" disabled={busy} onClick={() => ask("example")}>
									<i className="ri-file-list-3-line" aria-hidden="true"></i> Show a similar example
								</button>
							</div>
							<div className="ml-tutor__reply" role="status" aria-live="polite">
								{busy && <p className="ml-muted">Sage is thinking…</p>}
								{!busy && reply && (
									<>
										<p>{reply.text}</p>
										{reply.example && reply.mode === "example" && (
											<div className="ml-tutor__example">
												<QuestionView problem={reply.example} compact />
												{reply.example.choices && (
													<ul className="ml-example-choices">
														{reply.example.choices.map((c) => (
															<li key={c.label}>
																<strong>{c.label}.</strong> {c.text}
															</li>
														))}
													</ul>
												)}
												<p className="ml-small">
													<strong>Answer to the example:</strong> {reply.example.answer}
												</p>
											</div>
										)}
									</>
								)}
								{error && <p className="ml-note ml-note--danger">{error}</p>}
							</div>
							{caps && caps.chatEnabled && (
								<form
									className="ml-row"
									onSubmit={(e) => {
										e.preventDefault();
										if (message.trim()) ask("chat");
									}}
								>
									<label htmlFor="ml-tutor-msg" className="ss-sr-only">
										Message to Sage
									</label>
									<input id="ml-tutor-msg" className="ml-text" maxLength={300} placeholder="Ask Sage a question…" value={message} onChange={(e) => setMessage(e.target.value)} />
									<button type="submit" className="ss-btn ss-btn--sm" disabled={busy || !message.trim()}>
										Send
									</button>
								</form>
							)}
							{caps && !caps.aiAvailable && <p className="ml-hint">Sage is using built-in help right now.</p>}
						</>
					)}
				</div>
			)}
		</aside>
	);
};

export default TutorPanel;
