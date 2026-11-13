// Assign an existing Mastery Ladder worksheet to one student or a group: pick students, pick the
// worksheet (with a suggestion for the grade), set a due date, REVIEW, then publish.
// The server re-validates everything (scope, subjects, worksheet, due date) at both steps.
import React, { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { api } from "@/lib/mastery-client/api";
import { GRADES, recommendedIndex } from "@/lib/mastery/profile";

const useCurriculum = () => {
	const [data, setData] = useState(null);
	useEffect(() => {
		api.get("/curriculum", { learner: false, account: false }).then((d) => setData(d.subjects)).catch(() => setData([]));
	}, []);
	return data;
};

const AssignWorksheet = ({ students, preselect = [], onDone, onCancel }) => {
	const curriculum = useCurriculum();
	const [chosen, setChosen] = useState(preselect);
	const [q, setQ] = useState("");
	const [subject, setSubject] = useState("math");
	const [grade, setGrade] = useState("");
	const [setId, setSetId] = useState("");
	const [levelId, setLevelId] = useState("");
	const [worksheetNo, setWorksheetNo] = useState(1);
	const [dueAt, setDueAt] = useState("");
	const [instructions, setInstructions] = useState("");
	const [title, setTitle] = useState("");
	const [groupLabel, setGroupLabel] = useState("");
	const [courseId, setCourseId] = useState("");
	const [courses, setCourses] = useState([]);
	const [review, setReview] = useState(null);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState(null);
	const [done, setDone] = useState(null);

	useEffect(() => {
		axios.get("/api/courses").then((r) => setCourses(r.data.courses || [])).catch(() => {});
	}, []);

	const subj = useMemo(() => (curriculum || []).find((s) => s.id === subject), [curriculum, subject]);
	const readySets = useMemo(() => (subj ? subj.levels.flatMap((lv) => lv.sets.filter((s) => s.ready).map((s) => ({ ...s, levelId: lv.id, levelTitle: lv.title, stage: lv.stage }))) : []), [subj]);
	const current = readySets.find((s) => s.id === setId);
	const suggestion = readySets[recommendedIndex(grade, readySets.length)];

	// First load / subject change: start at the grade's suggestion (or the first set).
	useEffect(() => {
		if (!readySets.length) return;
		const pick = suggestion || readySets[0];
		setSetId(pick.id);
		setLevelId(pick.levelId);
		setWorksheetNo(1);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [subj, grade]);

	const candidates = students.filter((s) => s.subjects.includes(subject));
	const visible = candidates.filter((s) => !q.trim() || s.displayName.toLowerCase().includes(q.trim().toLowerCase()));
	const toggle = (id) => setChosen((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id]));

	const payload = () => ({
		learnerIds: chosen,
		subject,
		levelId,
		setId,
		worksheetNo: Number(worksheetNo),
		grade: grade || undefined,
		title: title.trim() || undefined,
		instructions: instructions.trim() || undefined,
		groupLabel: groupLabel.trim() || undefined,
		courseId: courseId || undefined,
		dueAt: dueAt ? new Date(dueAt).toISOString() : undefined,
	});

	const run = async (preview) => {
		setBusy(true);
		setError(null);
		try {
			const r = await api.post("/assignments", { ...payload(), preview }, { learner: false });
			if (preview) setReview(r);
			else setDone(r);
		} catch (e) {
			setError(e.message);
			if (!preview) setReview(null);
		} finally {
			setBusy(false);
		}
	};

	if (done) {
		const n = done.notified;
		return (
			<section className="ml-card ml-assign" aria-live="polite">
				<h2 className="ml-h3">{done.duplicate ? "Already assigned" : "Assigned"}</h2>
				<p>
					{done.title} was {done.duplicate ? "already assigned (your repeated request was ignored)" : "assigned"} to {done.students.map((s) => s.name).join(", ")}.
				</p>
				{n && n.created != null && (
					<p className="ml-muted ml-small">
						{n.created} family member{n.created === 1 ? "" : "s"} notified in the app.{" "}
						{n.email.sent > 0 ? `${n.email.sent} e-mail${n.email.sent === 1 ? "" : "s"} sent.` : "No e-mail was sent (e-mail is not configured, or the address is unconfirmed)."}
						{n.email.failed > 0 && ` ${n.email.failed} e-mail${n.email.failed === 1 ? "" : "s"} failed.`}
					</p>
				)}
				<div className="ml-row">
					<button type="button" className="ss-btn" onClick={() => onDone && onDone()}>Done</button>
				</div>
			</section>
		);
	}

	if (review) {
		return (
			<section className="ml-card ml-assign" aria-labelledby="review-title">
				<h2 id="review-title" className="ml-h3">Review before publishing</h2>
				<dl className="ml-assign__review">
					<div><dt>Worksheet</dt><dd>{review.title}</dd></div>
					<div><dt>Subject</dt><dd>{review.subjectName} · {review.setTitle} · worksheet {review.worksheetNo}</dd></div>
					<div><dt>Students ({review.students.length})</dt><dd>{review.students.map((s) => s.name).join(", ")}</dd></div>
					<div><dt>Due</dt><dd>{review.dueAt ? new Date(review.dueAt).toLocaleString() : "No due date"}</dd></div>
					{review.instructions && <div><dt>Instructions</dt><dd>{review.instructions}</dd></div>}
				</dl>
				<p className="ml-muted ml-small">Each student sees it on their study page. Their family contacts are notified. It counts as completed only when the student submits it.</p>
				{error && <p className="ml-note ml-note--danger" role="alert">{error}</p>}
				<div className="ml-row">
					<button type="button" className="ss-btn" disabled={busy} onClick={() => run(false)}>{busy ? "Publishing…" : `Publish to ${review.students.length} student${review.students.length === 1 ? "" : "s"}`}</button>
					<button type="button" className="ss-btn ss-btn--ghost" disabled={busy} onClick={() => setReview(null)}>Back</button>
				</div>
			</section>
		);
	}

	return (
		<form
			className="ml-card ml-assign ml-form"
			aria-labelledby="assign-form-title"
			onSubmit={(e) => {
				e.preventDefault();
				if (chosen.length === 0) return setError("Choose at least one student.");
				run(true);
			}}
		>
			<h2 id="assign-form-title" className="ml-h3">Assign a worksheet</h2>
			<fieldset className="ml-field">
				<legend>Students ({chosen.length} selected)</legend>
				<div className="ml-row ml-row--wrap">
					<label className="visually-hidden" htmlFor="as-search">Search students</label>
					<input id="as-search" type="search" className="ml-text" placeholder="Search by name" value={q} onChange={(e) => setQ(e.target.value)} />
					<button type="button" className="ss-btn ss-btn--ghost ss-btn--sm" onClick={() => setChosen([...new Set([...chosen, ...visible.map((s) => s.id)])])}>Select all shown</button>
					<label className="visually-hidden" htmlFor="as-grade-pick">Select a whole grade</label>
					<select id="as-grade-pick" className="ml-text" value="" onChange={(e) => e.target.value && setChosen([...new Set([...chosen, ...candidates.filter((s) => s.grade === e.target.value).map((s) => s.id)])])}>
						<option value="">Select a whole grade…</option>
						{GRADES.map((g) => <option key={g.code} value={g.code}>{g.label}</option>)}
					</select>
					<button type="button" className="ss-btn ss-btn--ghost ss-btn--sm" disabled={!chosen.length} onClick={() => setChosen([])}>Clear</button>
				</div>
				{candidates.length === 0 ? (
					<p className="ml-muted">None of your students has this subject switched on.</p>
				) : (
					<ul className="ml-assign__students">
						{visible.map((s) => (
							<li key={s.id}>
								<label className="ml-check-row">
									<input type="checkbox" checked={chosen.includes(s.id)} onChange={() => toggle(s.id)} />
									<span aria-hidden="true">{s.avatar}</span> {s.displayName}
									{s.gradeLabel && <span className="ss-badge">{s.gradeLabel}</span>}
								</label>
							</li>
						))}
						{visible.length === 0 && <li className="ml-muted">No student matches “{q}”.</li>}
					</ul>
				)}
			</fieldset>
			<div className="ml-grid-2">
				<div className="ml-field">
					<label htmlFor="as-subject">Subject</label>
					<select id="as-subject" className="ml-text" value={subject} onChange={(e) => { setSubject(e.target.value); setChosen((c) => c.filter((id) => students.find((s) => s.id === id && s.subjects.includes(e.target.value)))); }}>
						{(curriculum || []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
					</select>
				</div>
				<div className="ml-field">
					<label htmlFor="as-grade">Suggest for grade</label>
					<select id="as-grade" className="ml-text" value={grade} onChange={(e) => setGrade(e.target.value)}>
						<option value="">No suggestion</option>
						{GRADES.map((g) => <option key={g.code} value={g.code}>{g.label}</option>)}
					</select>
					{grade && suggestion && <p className="ml-hint">Suggested start: {suggestion.title}. This is a starting point, not an official grade mapping.</p>}
				</div>
			</div>
			<div className="ml-grid-3">
				<div className="ml-field">
					<label htmlFor="as-level">Level (difficulty)</label>
					<select id="as-level" className="ml-text" value={levelId} onChange={(e) => { const first = readySets.find((s) => s.levelId === e.target.value); setLevelId(e.target.value); if (first) { setSetId(first.id); setWorksheetNo(1); } }}>
						{[...new Map(readySets.map((s) => [s.levelId, s])).values()].map((s) => <option key={s.levelId} value={s.levelId}>{s.stage}: {s.levelTitle}</option>)}
					</select>
				</div>
				<div className="ml-field">
					<label htmlFor="as-set">Worksheet set</label>
					<select id="as-set" className="ml-text" value={setId} onChange={(e) => { setSetId(e.target.value); setWorksheetNo(1); }}>
						{readySets.filter((s) => s.levelId === levelId).map((s) => <option key={s.id} value={s.id}>{s.title}</option>)}
					</select>
				</div>
				<div className="ml-field">
					<label htmlFor="as-no">Worksheet number</label>
					<select id="as-no" className="ml-text" value={worksheetNo} onChange={(e) => setWorksheetNo(e.target.value)}>
						{Array.from({ length: current ? current.worksheets : 5 }, (_, i) => <option key={i + 1} value={i + 1}>{i + 1}</option>)}
					</select>
				</div>
			</div>
			<div className="ml-grid-2">
				<div className="ml-field">
					<label htmlFor="as-due">Due date (optional)</label>
					<input id="as-due" type="datetime-local" className="ml-text" value={dueAt} onChange={(e) => setDueAt(e.target.value)} />
				</div>
				<div className="ml-field">
					<label htmlFor="as-course">Course (optional)</label>
					<select id="as-course" className="ml-text" value={courseId} onChange={(e) => setCourseId(e.target.value)}>
						<option value="">Not linked to a course</option>
						{courses.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
					</select>
				</div>
			</div>
			<div className="ml-grid-2">
				<div className="ml-field">
					<label htmlFor="as-title">Title (optional)</label>
					<input id="as-title" className="ml-text" maxLength={160} value={title} onChange={(e) => setTitle(e.target.value)} />
				</div>
				<div className="ml-field">
					<label htmlFor="as-group">Group name (optional)</label>
					<input id="as-group" className="ml-text" maxLength={80} value={groupLabel} onChange={(e) => setGroupLabel(e.target.value)} />
				</div>
			</div>
			<div className="ml-field">
				<label htmlFor="as-inst">Instructions (optional)</label>
				<textarea id="as-inst" className="ml-text" rows={2} maxLength={1000} value={instructions} onChange={(e) => setInstructions(e.target.value)} />
			</div>
			{error && <p className="ml-note ml-note--danger" role="alert">{error}</p>}
			<div className="ml-row">
				<button type="submit" className="ss-btn" disabled={busy || !curriculum}>{busy ? "Checking…" : "Review"}</button>
				<button type="button" className="ss-btn ss-btn--ghost" onClick={onCancel}>Cancel</button>
			</div>
		</form>
	);
};

export default AssignWorksheet;
