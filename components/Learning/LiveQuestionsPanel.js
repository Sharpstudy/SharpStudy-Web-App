import React, { useCallback, useEffect, useRef, useState } from "react";
import axios from "axios";
import cookie from "js-cookie";

// Live questions inside the existing Jitsi class. It is a sibling of the Jitsi
// frame: nothing here re-renders or reloads the video. Everything is polled
// from /api/live-questions/<key>/state (key = scheduled session id, or a course
// slug for the original course-level class); the server decides permissions,
// deadlines, grading and what each role may see. Correctness is never computed
// here: the colours below come from the key the server returns.

const POLL_MS = 2500;
const POLL_HIDDEN_MS = 8000;

const authHeaders = () => ({ Authorization: cookie.get("edmy_users_token") || "" });
const url = (slug, path = "") => `/api/live-questions/${encodeURIComponent(slug)}/${path}`.replace(/\/?$/, "/");

const errMessage = (e) => {
	if (!e.response) return "You appear to be offline. We'll keep trying.";
	return (e.response.data && e.response.data.message) || "Something went wrong.";
};

// Seconds left, based on the server clock offset (the server still enforces it).
function useCountdown(deadlineAt, offsetMs) {
	const [left, setLeft] = useState(null);
	useEffect(() => {
		if (!deadlineAt) return setLeft(null);
		const tick = () => setLeft(Math.max(0, Math.ceil((new Date(deadlineAt).getTime() - (Date.now() + offsetMs)) / 1000)));
		tick();
		const t = setInterval(tick, 250);
		return () => clearInterval(t);
	}, [deadlineAt, offsetMs]);
	return left;
}

const fmt = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];

// Images are private: they are fetched with the signed-in user's token (an <img src>
// cannot send it) and shown from a temporary object URL. `local` is an in-browser
// preview used right after an upload.
const AuthImage = ({ slug, id, alt = "", local, className = "ss-lq__img" }) => {
	const [src, setSrc] = useState(local || null);
	const [failed, setFailed] = useState(false);
	useEffect(() => {
		if (local) return setSrc(local);
		let alive = true;
		let obj = null;
		axios
			.get(url(slug, `images/${id}`), { responseType: "blob", headers: authHeaders() })
			.then((r) => {
				if (!alive) return;
				obj = URL.createObjectURL(r.data);
				setSrc(obj);
			})
			.catch(() => alive && setFailed(true));
		return () => {
			alive = false;
			if (obj) URL.revokeObjectURL(obj);
		};
	}, [slug, id, local]);
	if (failed) return <span className="ss-lq__img-missing">Image unavailable</span>;
	if (!src) return <span className="ss-lq__img-missing" aria-hidden="true">Loading image…</span>;
	// eslint-disable-next-line @next/next/no-img-element
	return <img src={src} alt={alt} className={className} />;
};

// An answer: its picture (if any) and its text.
const OptionBody = ({ slug, o, previews }) => (
	<>
		{o.imageId && <AuthImage slug={slug} id={o.imageId} local={previews && previews[o.imageId]} alt={o.text || "Answer picture"} className="ss-lq__img ss-lq__img--option" />}
		{o.text && <span>{o.text}</span>}
	</>
);

const readFile = (file) =>
	new Promise((resolve, reject) => {
		const r = new FileReader();
		r.onload = () => resolve(r.result);
		r.onerror = () => reject(new Error("Could not read that file."));
		r.readAsDataURL(file);
	});

// `correctId` is only passed when the key may be shown. `graded` colours the other answers red
// (instructor, or students once the answer is revealed).
const Bars = ({ slug, options, distribution, correctId, total, graded }) => (
	<ul className="ss-lq__bars">
		{options.map((o) => {
			const count = (distribution.find((d) => d.optionId === o.id) || {}).count || 0;
			const pct = total ? Math.round((count / total) * 100) : 0;
			const cls = correctId === o.id ? "is-correct" : graded && correctId ? "is-wrong" : "";
			return (
				<li key={o.id} className={cls}>
					<span className="ss-lq__bar-label">
						<OptionBody slug={slug} o={o} />
						{correctId === o.id && <i className="ri-check-line" aria-label="correct answer"></i>}
					</span>
					<span className="ss-lq__bar" aria-hidden="true">
						<span style={{ width: `${pct}%` }}></span>
					</span>
					<span className="ss-lq__bar-count">{count}</span>
				</li>
			);
		})}
	</ul>
);

// ------------------------------------------------------------- student

const StudentView = ({ slug, state, offsetMs, refresh }) => {
	const q = state.current;
	const [picked, setPicked] = useState(null);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState(null);
	const left = useCountdown(q && q.status === "open" ? q.deadlineAt : null, offsetMs);

	const questionId = q ? q.id : null;
	useEffect(() => {
		setPicked(null);
		setError(null);
	}, [questionId]);

	if (!q) return <p className="ss-muted">No question yet. Your instructor will publish one during the class — you can keep watching the video.</p>;

	const mine = q.myAnswer && q.myAnswer.optionId;
	const open = q.status === "open" && left !== 0;
	const choice = picked || mine;

	const submit = async () => {
		setBusy(true);
		setError(null);
		try {
			await axios.post(url(slug, `questions/${q.id}/answer`), { optionId: choice }, { headers: authHeaders() });
			await refresh();
		} catch (e) {
			setError(errMessage(e));
			refresh();
		} finally {
			setBusy(false);
		}
	};

	return (
		<div className="ss-lq__question">
			<div className="ss-lq__meta">
				<span className="ss-badge">Question {q.seq}</span>
				{q.status === "open" && left !== null && <span className={`ss-badge ${left <= 10 ? "ss-badge--warning" : ""}`} role="timer">{fmt(left)}</span>}
				{q.status === "closed" && <span className="ss-badge">Closed</span>}
				{q.revealed && <span className="ss-badge ss-badge--success">Answer revealed</span>}
			</div>
			{q.imageId && <AuthImage slug={slug} id={q.imageId} alt="Picture for this question" />}
			{q.text && <p className="ss-lq__text">{q.text}</p>}
			<ul className={`ss-lq__options ${q.options.some((o) => o.imageId) ? "ss-lq__options--pictures" : ""}`} role="radiogroup" aria-label="Answer options">
				{q.options.map((o) => {
					const isMine = mine === o.id;
					// Colours come from the key the server sent after the reveal, never from position.
					const state_ = q.revealed ? (o.id === q.correctOptionId ? "correct" : isMine ? "wrong" : "") : "";
					return (
						<li key={o.id}>
							<button
								type="button"
								role="radio"
								aria-checked={choice === o.id}
								className={`ss-lq__option ${choice === o.id ? "is-picked" : ""} ${state_ ? `is-${state_}` : ""}`}
								disabled={!open || busy || (!!mine && !q.allowChange)}
								onClick={() => setPicked(o.id)}
							>
								<OptionBody slug={slug} o={o} />
								{state_ === "correct" && <i className="ri-check-line" aria-label="correct answer"></i>}
								{state_ === "wrong" && <i className="ri-close-line" aria-label="your answer, incorrect"></i>}
							</button>
						</li>
					);
				})}
			</ul>
			{open && (!mine || q.allowChange) && (
				<button type="button" className="ss-btn" disabled={busy || !choice || choice === mine} onClick={submit}>
					{mine ? "Change answer" : busy ? "Sending…" : "Submit answer"}
				</button>
			)}
			{mine && q.status === "open" && (
				<p className="ss-lq__note" role="status"><i className="ri-checkbox-circle-line" aria-hidden="true"></i> Answer received. Waiting for your instructor to close the question.</p>
			)}
			{!mine && q.status !== "open" && <p className="ss-lq__note">You did not answer this question.</p>}
			{error && <p className="ss-lq__error" role="alert">{error}</p>}
			{q.results && (
				<div>
					<h4 className="ss-lq__h">How the class answered</h4>
					<Bars slug={slug} options={q.options} distribution={q.results.distribution} correctId={q.correctOptionId} graded={q.revealed} total={q.results.total} />
				</div>
			)}
			{q.revealed && (
				<div className="ss-lq__reveal">
					<p>
						<strong>{q.myAnswer ? (q.myAnswer.isCorrect ? "Correct!" : "Not quite.") : "Correct answer:"}</strong>{" "}
						{(q.options.find((o) => o.id === q.correctOptionId) || {}).text}
					</p>
					{q.explanation && <p>{q.explanation}</p>}
				</div>
			)}
		</div>
	);
};

// ---------------------------------------------------------- instructor

const blankOption = () => ({ text: "", imageId: null });
// No answer is pre-selected: the correct one must be chosen on purpose.
const blank = () => ({ kind: "single", text: "", imageId: null, options: [blankOption(), blankOption()], correctIndex: null, explanation: "", durationSec: "", allowChange: false });

const fromDraft = (d) => ({
	kind: d.kind || "single",
	text: d.text || "",
	imageId: d.imageId || null,
	options: d.options.map((o) => ({ text: o.text || "", imageId: o.imageId || null })),
	correctIndex: d.correctIndex >= 0 ? d.correctIndex : null,
	explanation: d.explanation || "",
	durationSec: d.durationSec || "",
	allowChange: !!d.allowChange,
});

// One image slot (question picture, or an answer's picture): choose, preview, remove.
const ImagePicker = ({ slug, label, imageId, previews, onUploaded, onRemove, onError }) => {
	const [busy, setBusy] = useState(false);
	const choose = async (e) => {
		const file = e.target.files && e.target.files[0];
		e.target.value = "";
		if (!file) return;
		if (!IMAGE_TYPES.includes(file.type)) return onError("Use a PNG, JPEG, WebP or GIF image.");
		if (file.size > 1024 * 1024) return onError("Images must be 1 MB or smaller.");
		setBusy(true);
		onError(null);
		try {
			const data = await readFile(file);
			const r = await axios.post(url(slug, "images"), { data }, { headers: authHeaders() });
			onUploaded(r.data.imageId, data);
		} catch (err) {
			onError(errMessage(err));
		} finally {
			setBusy(false);
		}
	};
	return (
		<div className="ss-lq__picker">
			{imageId ? (
				<>
					<AuthImage slug={slug} id={imageId} local={previews[imageId]} alt={`${label} preview`} className="ss-lq__img ss-lq__img--preview" />
					<button type="button" className="ss-btn ss-btn--ghost ss-btn--sm" onClick={onRemove}>Remove picture</button>
				</>
			) : (
				<label className="ss-btn ss-btn--ghost ss-btn--sm">
					{busy ? "Uploading…" : `Add ${label}`}
					<input type="file" accept={IMAGE_TYPES.join(",")} hidden disabled={busy} onChange={choose} />
				</label>
			)}
		</div>
	);
};

const Composer = ({ slug, draft, onDone, onCancel }) => {
	const [f, setF] = useState(() => (draft ? fromDraft(draft) : blank()));
	const [previews, setPreviews] = useState({});
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState(null);
	const [importable, setImportable] = useState(null);
	const tf = f.kind === "true_false";
	const options = tf ? [{ text: "True" }, { text: "False" }] : f.options;

	const loadImportable = async () => {
		try {
			const r = await axios.get(url(slug, "importable"), { headers: authHeaders() });
			setImportable(r.data.questions);
		} catch (e) {
			setError(errMessage(e));
		}
	};
	const setOpt = (i, patch) => setF({ ...f, options: f.options.map((o, j) => (j === i ? { ...o, ...patch } : o)) });
	const remember = (id, data) => setPreviews((p) => ({ ...p, [id]: data }));

	const problem = () => {
		if (!f.text.trim() && !f.imageId) return "Add the question text or a picture.";
		if (!tf && options.some((o) => !o.text.trim() && !o.imageId)) return "Every answer needs text or a picture.";
		if (f.correctIndex === null || f.correctIndex === undefined) return "Select the correct answer before saving.";
		return null;
	};

	const save = async (publish) => {
		const p = problem();
		if (p) return setError(p);
		setBusy(true);
		setError(null);
		const body = {
			kind: f.kind,
			text: f.text,
			imageId: f.imageId,
			options: options.map((o) => ({ text: o.text || "", imageId: o.imageId || null })),
			correctIndex: f.correctIndex,
			explanation: f.explanation,
			durationSec: f.durationSec === "" ? null : Number(f.durationSec),
			allowChange: f.allowChange,
			sourceQuestionId: f.sourceQuestionId,
		};
		try {
			if (draft) {
				await axios.put(url(slug, `questions/${draft.id}`), body, { headers: authHeaders() });
				if (publish) await axios.post(url(slug, `questions/${draft.id}`), { action: "publish" }, { headers: authHeaders() });
			} else {
				await axios.post(url(slug, "questions"), { ...body, publish }, { headers: authHeaders() });
			}
			onDone();
		} catch (e) {
			setError(errMessage(e));
		} finally {
			setBusy(false);
		}
	};

	const removeOption = (i) =>
		setF({
			...f,
			options: f.options.filter((_, j) => j !== i),
			// removing the correct answer clears the key; removing an earlier one keeps it on the same answer
			correctIndex: f.correctIndex === i ? null : f.correctIndex !== null && f.correctIndex > i ? f.correctIndex - 1 : f.correctIndex,
		});
	const answer = f.correctIndex !== null && options[f.correctIndex];

	return (
		<form className="ss-lq__form" onSubmit={(e) => e.preventDefault()} noValidate>
			<h4 className="ss-lq__h">{draft ? "Edit question" : "New question"}</h4>
			<label className="form-label" htmlFor="lq-kind">Type</label>
			<select id="lq-kind" className="form-control" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value, correctIndex: null })}>
				<option value="single">Multiple choice (text and/or pictures)</option>
				<option value="true_false">True / False</option>
			</select>
			{!draft && !tf && (importable === null ? (
				<button type="button" className="ss-btn ss-btn--ghost ss-btn--sm" onClick={loadImportable}>Use a question from my quizzes</button>
			) : importable.length === 0 ? (
				<p className="ss-muted">No single-answer quiz questions found.</p>
			) : (
				<select
					className="form-control"
					aria-label="Copy an existing quiz question"
					defaultValue=""
					onChange={(e) => {
						const q = importable.find((x) => x.id === e.target.value);
						// The imported key is shown selected so it can be checked; nothing is saved until you press a save button.
						if (q) setF({ ...f, text: q.text, options: q.options.map((t) => ({ text: t, imageId: null })), correctIndex: q.correctIndex, sourceQuestionId: q.id });
					}}
				>
					<option value="">Copy a question from my quizzes…</option>
					{importable.map((q) => <option key={q.id} value={q.id}>{q.quizTitle}: {q.text.slice(0, 60)}</option>)}
				</select>
			))}
			<label className="form-label" htmlFor="lq-text">Question</label>
			<textarea id="lq-text" className="form-control" rows={2} maxLength={500} value={f.text} onChange={(e) => setF({ ...f, text: e.target.value })} />
			<ImagePicker slug={slug} label="a picture, diagram or map to the question" imageId={f.imageId} previews={previews} onError={setError}
				onUploaded={(id, data) => { remember(id, data); setF({ ...f, imageId: id }); }} onRemove={() => setF({ ...f, imageId: null })} />
			<fieldset className="ss-lq__opts">
				<legend className="form-label">Answers — choose the one that is correct</legend>
				{options.map((o, i) => (
					<div key={i} className={`ss-lq__opt-row ${f.correctIndex === i ? "is-key" : ""}`}>
						<input type="radio" name="lq-correct" aria-label={`Option ${i + 1} is the correct answer`} checked={f.correctIndex === i} onChange={() => setF({ ...f, correctIndex: i })} />
						{tf ? (
							<strong>{o.text}</strong>
						) : (
							<div className="ss-lq__opt-fields">
								<input className="form-control" aria-label={`Option ${i + 1} text`} maxLength={200} placeholder={`Answer ${i + 1}`} value={o.text} onChange={(e) => setOpt(i, { text: e.target.value })} />
								<ImagePicker slug={slug} label="picture" imageId={o.imageId} previews={previews} onError={setError}
									onUploaded={(id, data) => { remember(id, data); setOpt(i, { imageId: id }); }} onRemove={() => setOpt(i, { imageId: null })} />
							</div>
						)}
						{f.correctIndex === i ? <span className="ss-badge ss-badge--success">Correct</span> : <span />}
						{!tf && f.options.length > 2 && (
							<button type="button" className="ss-btn ss-btn--ghost ss-btn--sm" aria-label={`Remove option ${i + 1}`} onClick={() => removeOption(i)}>
								<i className="ri-close-line" aria-hidden="true"></i>
							</button>
						)}
					</div>
				))}
				{!tf && f.options.length < 6 && <button type="button" className="ss-btn ss-btn--ghost ss-btn--sm" onClick={() => setF({ ...f, options: [...f.options, blankOption()] })}>+ Add option</button>}
				{f.correctIndex === null && <p className="ss-lq__note" role="status">No correct answer selected yet.</p>}
			</fieldset>
			<label className="form-label" htmlFor="lq-expl">Explanation (shown when you reveal the answer)</label>
			<textarea id="lq-expl" className="form-control" rows={2} maxLength={1000} value={f.explanation} onChange={(e) => setF({ ...f, explanation: e.target.value })} />
			<div className="ss-lq__row">
				<div>
					<label className="form-label" htmlFor="lq-dur">Countdown (seconds, optional)</label>
					<input id="lq-dur" type="number" min={5} max={3600} className="form-control" value={f.durationSec} onChange={(e) => setF({ ...f, durationSec: e.target.value })} />
				</div>
				<label className="ss-lq__check"><input type="checkbox" checked={f.allowChange} onChange={(e) => setF({ ...f, allowChange: e.target.checked })} /> Students may change their answer before the deadline</label>
			</div>
			<div className="ss-lq__preview" aria-label="Preview of what students will see">
				<h5 className="ss-lq__h">Preview — what students will see</h5>
				{f.imageId && <AuthImage slug={slug} id={f.imageId} local={previews[f.imageId]} alt="Question picture" />}
				<p className="ss-lq__text">{f.text || <span className="ss-muted">(picture only)</span>}</p>
				<ul className="ss-lq__options">
					{options.map((o, i) => (
						<li key={i}><span className="ss-lq__option" style={{ display: "flex", gap: 8, alignItems: "center" }}><OptionBody slug={slug} o={o} previews={previews} /></span></li>
					))}
				</ul>
				{answer && <p className="ss-lq__note">Correct answer: <strong>{answer.text || `picture ${f.correctIndex + 1}`}</strong> (only you can see this until you reveal it)</p>}
			</div>
			{error && <p className="ss-lq__error" role="alert">{error}</p>}
			<div className="ss-lq__actions">
				<button type="button" className="ss-btn" disabled={busy} onClick={() => save(true)}>Publish now</button>
				<button type="button" className="ss-btn ss-btn--ghost" disabled={busy} onClick={() => save(false)}>Save as draft</button>
				{onCancel && <button type="button" className="ss-btn ss-btn--ghost" onClick={onCancel}>Cancel</button>}
			</div>
		</form>
	);
};

const KeyFixer = ({ slug, q, act, busy }) => {
	const [open, setOpen] = useState(false);
	const [choice, setChoice] = useState("");
	if (!open) return <button type="button" className="ss-btn ss-btn--ghost ss-btn--sm" onClick={() => setOpen(true)}>Wrong answer marked? Fix it</button>;
	return (
		<div className="ss-lq__fix">
			<label className="form-label" htmlFor={`fix-${q.id}`}>The correct answer is…</label>
			<select id={`fix-${q.id}`} className="form-control" value={choice} onChange={(e) => setChoice(e.target.value)}>
				<option value="">Choose…</option>
				{q.options.map((o) => <option key={o.id} value={o.id}>{o.text || "(picture)"}</option>)}
			</select>
			<button type="button" className="ss-btn ss-btn--sm" disabled={busy || !choice || choice === q.correctOptionId} onClick={async () => { await act(q.id, "set_correct", { optionId: choice }); setOpen(false); }}>
				Save and re-grade this question
			</button>
		</div>
	);
};

const InstructorView = ({ slug, state, offsetMs, refresh }) => {
	const q = state.current;
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState(null);
	const [composing, setComposing] = useState(false);
	const [editing, setEditing] = useState(null);
	const [review, setReview] = useState(null);
	const left = useCountdown(q && q.status === "open" ? q.deadlineAt : null, offsetMs);

	const act = async (id, action, extra = {}) => {
		setBusy(true);
		setError(null);
		try {
			await axios.post(url(slug, `questions/${id}`), { action, ...extra }, { headers: authHeaders() });
			await refresh();
		} catch (e) {
			setError(errMessage(e));
		} finally {
			setBusy(false);
		}
	};
	const delDraft = async (id) => {
		try {
			await axios.delete(url(slug, `questions/${id}`), { headers: authHeaders() });
			await refresh();
		} catch (e) {
			setError(errMessage(e));
		}
	};
	const loadReview = async () => {
		try {
			const r = await axios.get(url(slug, "questions"), { headers: authHeaders() });
			setReview(r.data.questions);
		} catch (e) {
			setError(errMessage(e));
		}
	};
	const keyText = q && (q.options.find((o) => o.id === q.correctOptionId) || {}).text;

	return (
		<div className="ss-lq__instructor">
			{q && (
				<div className="ss-lq__question">
					<div className="ss-lq__meta">
						<span className="ss-badge">Question {q.seq}</span>
						<span className={`ss-badge ${q.status === "open" ? "ss-badge--success" : ""}`}>{q.status}</span>
						{q.status === "open" && left !== null && <span className="ss-badge" role="timer">{fmt(left)}</span>}
						<span className="ss-badge">{q.totals.answered}/{q.totals.enrolled} answered</span>
					</div>
					{q.imageId && <AuthImage slug={slug} id={q.imageId} alt="Question picture" />}
					{q.text && <p className="ss-lq__text">{q.text}</p>}
					<Bars slug={slug} options={q.options} distribution={q.distribution} correctId={q.correctOptionId} graded total={q.totals.answered} />
					<p className="ss-lq__note">Saved answer key: <strong>{keyText || "picture"}</strong> · Correct answers: {q.totals.correct} of {q.totals.answered}</p>
					<div className="ss-lq__actions">
						{q.status === "open" && <button type="button" className="ss-btn ss-btn--sm" disabled={busy} onClick={() => act(q.id, "close")}>Close submissions</button>}
						{q.status !== "revealed" && <button type="button" className="ss-btn ss-btn--sm" disabled={busy} onClick={() => act(q.id, "reveal")}>Reveal answer</button>}
						{!q.resultsPublished && <button type="button" className="ss-btn ss-btn--ghost ss-btn--sm" disabled={busy} onClick={() => act(q.id, "publish_results")}>Publish results to students</button>}
						{q.resultsPublished && <span className="ss-badge">Results published</span>}
					</div>
					<KeyFixer slug={slug} q={q} act={act} busy={busy} />
					<details>
						<summary>Who has answered ({q.answered.length}) / waiting ({q.pending.length})</summary>
						<ul className="ss-lq__people">
							{q.answered.map((a) => <li key={a.userId}>{a.name} — {q.options.find((o) => o.id === a.optionId)?.text || "picture"} {a.isCorrect ? "✓" : "✗"}</li>)}
							{q.pending.map((p) => <li key={p.userId} className="ss-muted">{p.name} — not answered</li>)}
						</ul>
					</details>
				</div>
			)}
			{!q && <p className="ss-muted">No questions asked yet. Publishing a question does not interrupt the video.</p>}

			{state.drafts.length > 0 && !editing && (
				<div>
					<h4 className="ss-lq__h">Drafts</h4>
					<ul className="ss-lq__people">
						{state.drafts.map((d) => (
							<li key={d.id}>
								{d.imageId && <i className="ri-image-line" aria-label="has a picture"></i>} {(d.text || "(picture)").slice(0, 50)}{" "}
								<button type="button" className="ss-btn ss-btn--sm" disabled={busy} onClick={() => act(d.id, "publish")}>Publish</button>{" "}
								<button type="button" className="ss-btn ss-btn--ghost ss-btn--sm" onClick={() => { setEditing(d); setComposing(true); }}>Edit</button>{" "}
								<button type="button" className="ss-btn ss-btn--ghost ss-btn--sm" onClick={() => delDraft(d.id)}>Delete</button>
							</li>
						))}
					</ul>
				</div>
			)}
			{error && <p className="ss-lq__error" role="alert">{error}</p>}
			{composing ? (
				<Composer key={editing ? editing.id : "new"} slug={slug} draft={editing} onDone={() => { setComposing(false); setEditing(null); refresh(); }} onCancel={() => { setComposing(false); setEditing(null); }} />
			) : (
				<div className="ss-lq__actions">
					<button type="button" className="ss-btn" onClick={() => setComposing(true)}>{q ? "Next question" : "Ask a question"}</button>
					<button type="button" className="ss-btn ss-btn--ghost" onClick={loadReview}>Review saved results</button>
				</div>
			)}
			{review && (
				<div>
					<h4 className="ss-lq__h">Saved results</h4>
					{review.length === 0 && <p className="ss-muted">Nothing yet.</p>}
					{review.map((r) => (
						<details key={r.id}>
							<summary>Q{r.seq}: {(r.text || "(picture)").slice(0, 50)} — {r.totals.correct}/{r.totals.answered} correct</summary>
							<Bars slug={slug} options={r.options} distribution={r.distribution} correctId={r.correctOptionId} graded total={r.totals.answered} />
						</details>
					))}
				</div>
			)}
		</div>
	);
};

// ------------------------------------------------------------- panel

const LiveQuestionsPanel = ({ slug }) => {
	const [state, setState] = useState(null);
	const [error, setError] = useState(null);
	const [offsetMs, setOffsetMs] = useState(0);
	const [open, setOpen] = useState(true);
	const [unseen, setUnseen] = useState(false);
	const lastId = useRef(null);
	const alive = useRef(true);

	const refresh = useCallback(async () => {
		try {
			const r = await axios.get(url(slug, "state"), { headers: authHeaders(), timeout: 8000 });
			if (!alive.current) return;
			setOffsetMs(new Date(r.data.serverTime).getTime() - Date.now());
			setState(r.data);
			setError(null);
			const id = r.data.current && r.data.current.id;
			if (id && id !== lastId.current && r.data.role === "student") setUnseen(true);
			lastId.current = id || lastId.current;
		} catch (e) {
			if (alive.current) setError(errMessage(e));
		}
	}, [slug]);

	useEffect(() => {
		alive.current = true;
		let timer;
		const loop = async () => {
			await refresh();
			if (alive.current) timer = setTimeout(loop, typeof document !== "undefined" && document.hidden ? POLL_HIDDEN_MS : POLL_MS);
		};
		loop();
		return () => {
			alive.current = false;
			clearTimeout(timer);
		};
	}, [refresh]);

	if (!state && !error) return <aside className="ss-lq ss-card"><p className="ss-muted" role="status">Loading questions…</p></aside>;
	// A hard 4xx (not signed in / not in this class) means no panel at all.
	if (!state && error) return <aside className="ss-lq ss-card"><p className="ss-lq__error" role="alert">{error}</p></aside>;

	return (
		<aside className="ss-lq ss-card" aria-label="Live questions">
			<button type="button" className="ss-lq__toggle" aria-expanded={open} onClick={() => { setOpen(!open); setUnseen(false); }}>
				<span><i className="ri-question-answer-line" aria-hidden="true"></i> Live questions</span>
				{unseen && !open && <span className="ss-badge ss-badge--warning">New question</span>}
				<i className={open ? "ri-arrow-up-s-line" : "ri-arrow-down-s-line"} aria-hidden="true"></i>
			</button>
			{error && <p className="ss-lq__error" role="status">{error}</p>}
			{open && (
				<div className="ss-lq__body">
					{state.role === "instructor" ? (
						<InstructorView slug={slug} state={state} offsetMs={offsetMs} refresh={refresh} />
					) : (
						<StudentView slug={slug} state={state} offsetMs={offsetMs} refresh={refresh} />
					)}
				</div>
			)}
		</aside>
	);
};

export default LiveQuestionsPanel;
