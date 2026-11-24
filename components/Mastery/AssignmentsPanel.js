// Assigned worksheets. ONE component for the learner's own page (mode "learner") and the
// Family / instructor dashboard (mode "adult"): both receive the same server-computed records
// (lib/mastery/assignmentModel.js), so statuses, counts and scores cannot differ.
import React, { useState } from "react";
import Link from "next/link";
import { api } from "@/lib/mastery-client/api";

export const STATUS = {
	pending: { label: "Not started", tone: "" },
	in_progress: { label: "In progress", tone: "primary" },
	completed: { label: "Completed", tone: "success" },
	overdue: { label: "Overdue", tone: "danger" },
	cancelled: { label: "Cancelled", tone: "" },
};
const fmtDue = (d) => (d ? new Date(d).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "No due date");
const fmtWhen = (d) => (d ? new Date(d).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "–");
const href = (a) => `/study/worksheet/?subject=${a.subject}&level=${encodeURIComponent(a.levelId)}&set=${encodeURIComponent(a.setId)}&ws=${a.worksheetNo}&assignment=${a.id}`;

export const Counts = ({ counts }) => (
	<dl className="ml-assign__counts" aria-label="Assignment totals">
		{[
			["Assigned", counts.assigned],
			["Not started", counts.pending],
			["In progress", counts.inProgress],
			["Completed", counts.completed],
			["Overdue", counts.overdue],
		].map(([k, v]) => (
			<div key={k} className={k === "Overdue" && v > 0 ? "is-alert" : ""}>
				<dt>{k}</dt>
				<dd>{v}</dd>
			</div>
		))}
	</dl>
);

const Result = ({ r }) =>
	r ? (
		<p className="ml-small">
			<strong>
				{r.correctFirst}/{r.total} first try
			</strong>{" "}
			· <span aria-label={`${r.stars} stars`}>{"★".repeat(r.stars) || "no stars"}</span> · {r.feedback}
		</p>
	) : null;

const Row = ({ a, mode, canManage, onChanged }) => {
	const st = STATUS[a.status] || STATUS.pending;
	const [msg, setMsg] = useState(null);
	const [busy, setBusy] = useState(false);
	const [editing, setEditing] = useState(false);
	const [due, setDue] = useState("");
	const act = async (body, done) => {
		setBusy(true);
		setMsg(null);
		try {
			await api.patch(`/assignments/${a.id}`, body, { learner: false });
			setEditing(false);
			onChanged && onChanged(done);
		} catch (e) {
			setMsg(e.message);
		} finally {
			setBusy(false);
		}
	};
	return (
		<li className={`ml-assign__item is-${a.status}`}>
			<div className="ml-assign__main">
				<p className="ml-assign__title">
					<strong>{a.title}</strong> <span className={`ss-badge${st.tone ? ` ss-badge--${st.tone}` : ""}`}>{a.overdue && a.status !== "overdue" ? "Overdue" : st.label}</span>
					{a.groupLabel && <span className="ss-badge">{a.groupLabel}</span>}
				</p>
				<p className="ml-muted ml-small">
					{a.subjectName} · {a.setTitle} · worksheet {a.worksheetNo}
					{a.grade ? ` · for ${a.grade === "LKG" || a.grade === "UKG" ? a.grade : `Class ${a.grade.slice(1)}`}` : ""} · from {a.instructorName}
				</p>
				<p className="ml-small">
					Due: <strong>{fmtDue(a.dueAt)}</strong>
					{a.completedAt && <> · Finished {fmtWhen(a.completedAt)}</>}
					{!a.completedAt && a.startedAt && <> · Started {fmtWhen(a.startedAt)}</>}
				</p>
				{a.instructions && <p className="ml-assign__note">{a.instructions}</p>}
				<Result r={a.result} />
				{msg && <p className="ml-note ml-note--danger" role="alert">{msg}</p>}
			</div>
			<div className="ml-assign__actions">
				{mode === "learner" && !a.cancelled && (
					<Link href={href(a)}>
						<a className="ss-btn ss-btn--sm">{a.status === "completed" ? "Practise again" : a.status === "in_progress" ? "Continue" : "Start"}</a>
					</Link>
				)}
				{mode === "adult" && canManage && !a.cancelled && (
					<>
						{!editing ? (
							<button type="button" className="ss-btn ss-btn--ghost ss-btn--sm" onClick={() => setEditing(true)}>Change due date</button>
						) : (
							<form
								className="ml-row ml-row--wrap"
								onSubmit={(e) => {
									e.preventDefault();
									act({ dueAt: due ? new Date(due).toISOString() : null }, "Due date updated.");
								}}
							>
								<label className="visually-hidden" htmlFor={`due-${a.id}`}>New due date</label>
								<input id={`due-${a.id}`} type="datetime-local" className="ml-text" value={due} onChange={(e) => setDue(e.target.value)} />
								<button type="submit" className="ss-btn ss-btn--sm" disabled={busy}>Save</button>
								<button type="button" className="ss-btn ss-btn--ghost ss-btn--sm" onClick={() => setEditing(false)}>Cancel</button>
							</form>
						)}
						{a.status !== "completed" && (
							<button
								type="button"
								className="ss-btn ss-btn--ghost ss-btn--sm"
								disabled={busy}
								onClick={() => window.confirm(`Cancel "${a.title}" for this student? Their earlier results are kept.`) && act({ cancel: true }, "Assignment cancelled.")}
							>
								Cancel assignment
							</button>
						)}
					</>
				)}
			</div>
		</li>
	);
};

// props: items, counts, mode, canManage, onChanged(message)
const AssignmentsPanel = ({ items, counts, mode = "adult", canManage = false, onChanged, lastUpdateAt, stale, refreshing, onRefresh, error }) => {
	const shown = (items || []).filter((a) => mode === "adult" || !a.cancelled);
	return (
		<section className="ml-card ml-assign" aria-labelledby="assign-title">
			<div className="ml-assign__head">
				<h2 id="assign-title" className="ml-h3">{mode === "learner" ? "Assigned to you" : "Assigned worksheets"}</h2>
				{onRefresh && (
					<button type="button" className="ss-btn ss-btn--ghost ss-btn--sm" onClick={onRefresh} disabled={refreshing}>
						<i className="ri-refresh-line" aria-hidden="true"></i> {refreshing ? "Refreshing…" : "Refresh"}
					</button>
				)}
			</div>
			{error && <p className="ml-note ml-note--warning" role="alert">{error} {lastUpdateAt && "Showing the last information received."}</p>}
			{stale && !error && <p className="ml-muted ml-small" role="status">Updated {stale}</p>}
			<Counts counts={counts} />
			{shown.length === 0 ? (
				<p className="ml-muted">{mode === "learner" ? "Nothing has been assigned to you yet." : "No worksheets have been assigned yet."}</p>
			) : (
				<ul className="ml-assign__list">
					{shown.map((a) => (
						<Row key={a.id + a.learnerId} a={a} mode={mode} canManage={canManage} onChanged={onChanged} />
					))}
				</ul>
			)}
		</section>
	);
};

export default AssignmentsPanel;
