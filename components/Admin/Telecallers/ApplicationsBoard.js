import React, { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/router";
import axios from "axios";
import toast from "react-hot-toast";
import { StatusBadge, STATUS_LABEL, ListState, Facts, ResumeVersions, AttemptHistory, msg, fmt, fmtDay } from "./shared";

// Admin > Telecallers > Applications (view="open": pending + more information requested) and Rejected Applications
// (view="rejected"). Reads and acts through /api/admin/telecallers/applications; every call is authorised on the server
// (admin role re-read from the database), so nothing here grants anything.
const API = "/api/admin/telecallers/applications";

const CARDS = [
	["pending", "Pending", "ri-time-line", "/admin/telecallers/applications/"],
	["more_info_requested", "More info requested", "ri-question-line", "/admin/telecallers/applications/"],
	["approved", "Approved", "ri-checkbox-circle-line", "/admin/telecallers/approved/"],
	["rejected", "Rejected", "ri-close-circle-line", "/admin/telecallers/rejected/"],
];
const ACTIONS = {
	request_info: { label: "Request more information", variant: "", feedback: "Message to the applicant (what do you need?)" },
	approve: { label: "Approve", variant: "success", confirm: "Approve this applicant? They get an active telecaller profile. Their account role does not change.", feedback: "Message to the applicant (optional)", optional: true },
	reject: { label: "Reject", variant: "danger", confirm: "Reject this application? The applicant is told why and may apply again after the waiting period. Their account and this history are kept.", feedback: "Reason for the applicant" },
};

const Detail = ({ id, onChanged, onClose }) => {
	const [a, setA] = useState(null);
	const [error, setError] = useState("");
	const [notes, setNotes] = useState("");
	const [pending, setPending] = useState(null); // action awaiting confirmation
	const [feedback, setFeedback] = useState("");
	const [busy, setBusy] = useState(false);
	const busyRef = useRef(false);

	const apply = (app) => {
		setA(app);
		setNotes(app.admin_notes || "");
	};
	const load = useCallback(async () => {
		try {
			apply((await axios.get(API, { params: { id } })).data.application);
			setError("");
		} catch (e) {
			setError(msg(e));
		}
	}, [id]);
	useEffect(() => {
		setA(null);
		setPending(null);
		setFeedback("");
		load();
	}, [load]);

	const post = async (body, ok) => {
		if (busyRef.current) return;
		busyRef.current = true;
		setBusy(true);
		try {
			const { data } = await axios.post(API, { id, ...body });
			apply(data.application);
			setPending(null);
			setFeedback("");
			toast.success(ok);
			onChanged();
		} catch (e) {
			toast.error(msg(e));
			load();
		} finally {
			busyRef.current = false;
			setBusy(false);
		}
	};

	if (error && !a) return <div className="ss-alert ss-alert--danger" role="alert">{error} <button type="button" className="ss-link-btn" onClick={load}>Try again</button></div>;
	if (!a) return <p className="ss-muted" role="status">Loading application…</p>;
	const p = pending && ACTIONS[pending];
	const needsText = p && !p.optional && p.feedback;
	const person = a.applicant || {};

	return (
		<section className="ia-detail" aria-label={`Application from ${a.full_name || person.name}`}>
			<div className="ia-head">
				<div>
					<h2>{a.full_name || person.name}</h2>
					<p className="ss-muted">{person.email} {!person.email_confirmed && <span className="ss-badge ss-badge--warning">Email not verified</span>} · attempt {a.attempt} · submitted {fmt(a.submitted_at)}</p>
				</div>
				<div className="ia-head__side"><StatusBadge status={a.status} /><button type="button" className="ss-btn ss-btn--ghost ss-btn--sm" onClick={onClose}>Close</button></div>
			</div>
			<p className="ss-muted ia-note">Details below are what the applicant reported. They have <strong>not</strong> been independently verified.</p>

			<div className="ia-cols">
				<div>
					<h3 className="ss-subhead">Applicant</h3>
					<Facts a={a} />
				</div>
				<div>
					<h3 className="ss-subhead">Resume versions (private)</h3>
					<ResumeVersions attempts={a.attempts} />
				</div>
			</div>

			<h3 className="ss-subhead">Private admin notes</h3>
			<label className="form-label" htmlFor="tc-notes">Never shown to the applicant</label>
			<textarea id="tc-notes" className="form-control" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={4000} />
			<div className="ia-actions"><button type="button" className="ss-btn ss-btn--ghost ss-btn--sm" disabled={busy} onClick={() => post({ action: "save_notes", admin_notes: notes }, "Notes saved.")}>Save notes</button></div>

			<h3 className="ss-subhead">Decision</h3>
			{a.profile && <p className="ss-muted">Approved on {fmtDay(a.profile.approved_at)}. Telecaller access is currently <strong>{a.profile.status}</strong>. <Link href="/admin/telecallers/approved/"><a>Manage approved telecallers</a></Link></p>}
			{!pending ? (
				<div className="ia-actions">
					{a.allowed.length === 0 && <span className="ss-muted">{a.status === "more_info_requested" ? "Waiting for the applicant to respond." : "No further decision is possible for this status."}</span>}
					{a.allowed.map((k) => (
						<button key={k} type="button" className={`ss-btn ss-btn--sm ${ACTIONS[k].variant ? `ss-btn--${ACTIONS[k].variant}` : ""}`} disabled={busy} onClick={() => setPending(k)}>{ACTIONS[k].label}</button>
					))}
				</div>
			) : (
				<div className="ia-confirm" role="alertdialog" aria-labelledby="tc-confirm-t">
					<p id="tc-confirm-t"><strong>{p.confirm || p.label}</strong></p>
					<label className="form-label" htmlFor="tc-fb">{p.feedback}</label>
					<textarea id="tc-fb" className="form-control" rows={3} value={feedback} onChange={(e) => setFeedback(e.target.value)} maxLength={2000} />
					{needsText && feedback.trim().length < 10 && <p className="ss-muted">At least 10 characters.</p>}
					<div className="ia-actions">
						<button type="button" className="ss-btn ss-btn--ghost ss-btn--sm" disabled={busy} onClick={() => setPending(null)}>Cancel</button>
						<button type="button" className={`ss-btn ss-btn--sm ${p.variant ? `ss-btn--${p.variant}` : ""}`} disabled={busy || (needsText && feedback.trim().length < 10)} onClick={() => post({ action: pending, confirm: true, feedback, admin_notes: notes }, `${p.label}: done.`)}>Confirm: {p.label}</button>
					</div>
				</div>
			)}

			<h3 className="ss-subhead">Status history by attempt</h3>
			<AttemptHistory attempts={a.attempts} />
		</section>
	);
};

const ApplicationsBoard = ({ view = "open" }) => {
	const router = useRouter();
	const [list, setList] = useState(null);
	const [error, setError] = useState("");
	const [q, setQ] = useState("");
	const [status, setStatus] = useState("");
	const [page, setPage] = useState(1);
	const [open, setOpen] = useState(null);
	const rejectedView = view === "rejected";

	useEffect(() => {
		if (router.isReady && router.query.open) setOpen(String(router.query.open));
	}, [router.isReady, router.query.open]);

	const load = useCallback(async () => {
		try {
			const { data } = await axios.get(API, { params: { view, q, status, page } });
			setList(data);
			setError("");
		} catch (e) {
			setError(msg(e));
		}
	}, [view, q, status, page]);
	useEffect(() => {
		const t = setTimeout(load, q ? 250 : 0);
		return () => clearTimeout(t);
	}, [load, q]);

	return (
		<>
			{list && (
				<div className="ia-cards">
					{CARDS.map(([k, label, icon, href]) => {
						const filterable = !rejectedView && (k === "pending" || k === "more_info_requested");
						const inner = (
							<>
								<i className={icon} aria-hidden="true"></i><strong>{list.counts[k]}</strong><span>{label}</span>
							</>
						);
						if (filterable) {
							return <button key={k} type="button" className={`ia-card-stat ${status === k ? "is-active" : ""}`} aria-pressed={status === k} onClick={() => { setStatus(status === k ? "" : k); setPage(1); }}>{inner}</button>;
						}
						const here = rejectedView && k === "rejected";
						return <Link key={k} href={href}><a className={`ia-card-stat ${here ? "is-active" : ""}`} aria-current={here ? "page" : undefined}>{inner}</a></Link>;
					})}
				</div>
			)}

			<div className="ia-filters">
				<label className="visually-hidden" htmlFor="tc-q">Search by name or email</label>
				<input id="tc-q" className="form-control" type="search" placeholder="Search by name or email" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
				{!rejectedView && (
					<>
						<label className="visually-hidden" htmlFor="tc-s">Status</label>
						<select id="tc-s" className="form-control" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
							<option value="">All open applications</option>
							{["pending", "more_info_requested"].map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
						</select>
					</>
				)}
			</div>

			{open && <Detail id={open} onChanged={load} onClose={() => setOpen(null)} />}

			<ListState
				error={error}
				loading={!list}
				onRetry={load}
				empty={list && list.applications.length === 0}
				emptyTitle={q || status ? "No applications found" : rejectedView ? "No rejected applications" : "No open applications"}
				emptyText={q || status ? "Try a different search or filter." : rejectedView ? "Rejected applications, with their decisions and history, appear here." : "When someone applies to become a telecaller, their application appears here."}
			>
				{list && (
					<>
						<div className="table-responsive">
							<table className="table align-middle table-hover fs-14">
								<caption className="visually-hidden">{rejectedView ? "Rejected telecaller applications" : "Telecaller applications"}</caption>
								<thead>
									<tr>
										<th scope="col">Applicant</th><th scope="col">Phone</th><th scope="col">Location</th><th scope="col">Qualification</th><th scope="col">Experience</th>
										<th scope="col">{rejectedView ? "Decided" : "Submitted"}</th><th scope="col">Status</th><th scope="col"><span className="visually-hidden">Action</span></th>
									</tr>
								</thead>
								<tbody>
									{list.applications.map((r) => (
										<tr key={r.id} className={open === r.id ? "table-active" : ""}>
											<td><strong>{r.name}</strong><br /><span className="ss-muted">{r.email}</span></td>
											<td>{r.phone || "–"}</td>
											<td>{[r.city, r.state].filter(Boolean).join(", ") || "–"}</td>
											<td>{r.qualification || "–"}</td>
											<td>{r.experience || "–"}</td>
											<td>{fmt(rejectedView ? r.decided_at : r.submitted_at)}</td>
											<td style={{ whiteSpace: "nowrap" }}><StatusBadge status={r.status} /><br /><span className="ss-muted">attempt {r.attempt}</span></td>
											<td><button type="button" className="ss-btn ss-btn--sm ss-btn--ghost" onClick={() => { setOpen(r.id); window.scrollTo && window.scrollTo({ top: 0, behavior: "smooth" }); }}>Review</button></td>
										</tr>
									))}
								</tbody>
							</table>
						</div>
						{list.pages > 1 && (
							<nav className="ia-pager" aria-label="Pagination">
								<button type="button" className="ss-btn ss-btn--ghost ss-btn--sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button>
								<span>Page {list.page} of {list.pages}</span>
								<button type="button" className="ss-btn ss-btn--ghost ss-btn--sm" disabled={page >= list.pages} onClick={() => setPage(page + 1)}>Next</button>
							</nav>
						)}
					</>
				)}
			</ListState>
		</>
	);
};

export default ApplicationsBoard;
