// The learner picker for the Family / instructor dashboard: search, filters and a summary card per
// learner. Data comes from /api/mastery/learners/overview, already limited by the server to
// learners the signed-in account owns or is linked to.
import React, { useEffect, useRef, useState } from "react";
import { api } from "@/lib/mastery-client/api";
import { GRADES } from "@/lib/mastery/profile";
import { SUBJECT_OPTIONS } from "./LearnerForm";

const STATUS_TEXT = { no_work: "No work assigned", not_started: "Not started", in_progress: "In progress", overdue: "Overdue", all_done: "All done" };
const TONE = { overdue: "danger", all_done: "success", in_progress: "primary" };
const ago = (d) => (d ? new Date(d).toLocaleDateString(undefined, { dateStyle: "medium" }) : "never");

const LearnerOverview = ({ selected, onSelect, onLoaded, refreshKey }) => {
	const [f, setF] = useState({ q: "", grade: "", subject: "", status: "" });
	const [data, setData] = useState(null);
	const [error, setError] = useState(null);
	const [loading, setLoading] = useState(true);
	const timer = useRef(null);

	useEffect(() => {
		clearTimeout(timer.current);
		timer.current = setTimeout(() => {
			setLoading(true);
			const qs = Object.entries(f).filter(([, v]) => v).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&");
			api
				.get(`/learners/overview${qs ? `?${qs}` : ""}`, { learner: false })
				.then((d) => {
					setData(d);
					setError(null);
					onLoaded && onLoaded(d);
				})
				.catch((e) => setError(e.message))
				.finally(() => setLoading(false));
		}, f.q ? 250 : 0);
		return () => clearTimeout(timer.current);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [f, refreshKey]);

	const filtered = !!(f.q || f.grade || f.subject || f.status);
	const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

	return (
		<section aria-label="Students">
			<form className="ml-overview__filters" role="search" onSubmit={(e) => e.preventDefault()}>
				<div className="ml-field">
					<label htmlFor="ov-q">Search by name</label>
					<input id="ov-q" type="search" className="ml-text" value={f.q} onChange={set("q")} />
				</div>
				<div className="ml-field">
					<label htmlFor="ov-grade">Grade</label>
					<select id="ov-grade" className="ml-text" value={f.grade} onChange={set("grade")}>
						<option value="">All grades</option>
						{GRADES.map((g) => <option key={g.code} value={g.code}>{g.label}</option>)}
					</select>
				</div>
				<div className="ml-field">
					<label htmlFor="ov-subject">Subject</label>
					<select id="ov-subject" className="ml-text" value={f.subject} onChange={set("subject")}>
						<option value="">All subjects</option>
						{SUBJECT_OPTIONS.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
					</select>
				</div>
				<div className="ml-field">
					<label htmlFor="ov-status">Learning status</label>
					<select id="ov-status" className="ml-text" value={f.status} onChange={set("status")}>
						<option value="">Any status</option>
						{Object.entries(STATUS_TEXT).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
					</select>
				</div>
			</form>
			{error && <p className="ml-note ml-note--danger" role="alert">{error}</p>}
			{loading && !data && <p className="ml-loading" role="status">Loading students…</p>}
			{data && (
				<p className="ml-muted ml-small" role="status">
					Showing {data.learners.length} of {data.total} student{data.total === 1 ? "" : "s"}
					{filtered && (
						<>
							{" "}· <button type="button" className="ml-linklike" onClick={() => setF({ q: "", grade: "", subject: "", status: "" })}>Clear filters</button>
						</>
					)}
				</p>
			)}
			{data && data.learners.length === 0 && (
				<p className="ml-note" role="status">{filtered ? "No student matches these filters." : "No students yet."}</p>
			)}
			{data && data.learners.length > 0 && (
				<ul className="ml-overview" aria-busy={loading}>
					{data.learners.map((l) => (
						<li key={l.id}>
							<button type="button" className={`ml-overview__card${selected === l.id ? " is-selected" : ""}`} aria-pressed={selected === l.id} onClick={() => onSelect(l.id)}>
								<span className="ml-avatar-lg" aria-hidden="true">{l.avatar}</span>
								<span className="ml-overview__body">
									<strong>{l.displayName}</strong>
									<span className="ml-muted ml-small">
										{l.gradeLabel || "Grade not set"}
										{l.age != null ? ` · age ${l.age}` : ""}
									</span>
									<span className="ml-small">{l.subjects.map((s) => (SUBJECT_OPTIONS.find((o) => o.id === s) || {}).name || s).join(", ") || "No subjects on"}</span>
									<span className="ml-small">
										<span className={`ss-badge${TONE[l.status] ? ` ss-badge--${TONE[l.status]}` : ""}`}>{STATUS_TEXT[l.status]}</span>{" "}
										{l.counts.assigned > 0 && `${l.counts.completed}/${l.counts.assigned} done`}
										{l.counts.overdue > 0 && ` · ${l.counts.overdue} overdue`}
									</span>
									<span className="ml-muted ml-small">Last practised: {ago(l.lastActivityAt)}</span>
								</span>
								{l.relation !== "owner" && <span className="ss-badge">{l.relation}</span>}
							</button>
						</li>
					))}
				</ul>
			)}
		</section>
	);
};

export default LearnerOverview;
