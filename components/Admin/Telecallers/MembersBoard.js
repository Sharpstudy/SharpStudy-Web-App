import React, { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/router";
import axios from "axios";
import toast from "react-hot-toast";
import { ListState, Facts, ResumeVersions, AttemptHistory, msg, fmt, fmtDay } from "./shared";

// Admin > Telecallers > Approved Telecallers. Reads and acts through /api/admin/telecallers/members; every call is
// authorised on the server. Deactivating takes effect on the telecaller's next request: access is read from the
// telecaller profile each time, there is no session or token claim to wait out.
const API = "/api/admin/telecallers/members";

export const AccessBadge = ({ status }) => <span className={`ss-badge ss-badge--${status === "active" ? "success" : "danger"}`}>{status === "active" ? "Active" : "Deactivated"}</span>;

const Detail = ({ id, onChanged, onClose }) => {
	const [d, setD] = useState(null);
	const [error, setError] = useState("");
	const [pending, setPending] = useState(null); // "activate" | "deactivate"
	const [reason, setReason] = useState("");
	const [busy, setBusy] = useState(false);
	const busyRef = useRef(false);

	const load = useCallback(async () => {
		try {
			setD((await axios.get(API, { params: { id } })).data);
			setError("");
		} catch (e) {
			setError(msg(e));
		}
	}, [id]);
	useEffect(() => {
		setD(null);
		setPending(null);
		setReason("");
		load();
	}, [load]);

	const post = async () => {
		if (busyRef.current) return;
		busyRef.current = true;
		setBusy(true);
		try {
			const { data } = await axios.post(API, { id, action: pending, reason });
			setD(data);
			toast.success(pending === "activate" ? "Telecaller reactivated." : "Telecaller deactivated.");
			setPending(null);
			setReason("");
			onChanged();
		} catch (e) {
			toast.error(msg(e));
			load();
		} finally {
			busyRef.current = false;
			setBusy(false);
		}
	};

	if (error && !d) return <div className="ss-alert ss-alert--danger" role="alert">{error} <button type="button" className="ss-link-btn" onClick={load}>Try again</button></div>;
	if (!d) return <p className="ss-muted" role="status">Loading profile…</p>;
	const { profile: p, application: a } = d;
	const person = (a && a.applicant) || {};
	const needReason = pending === "deactivate";

	return (
		<section className="ia-detail" aria-label={`Telecaller ${(a && a.full_name) || person.name || ""}`}>
			<div className="ia-head">
				<div>
					<h2>{(a && a.full_name) || person.name || "Telecaller"}</h2>
					<p className="ss-muted">{person.email} · approved {fmtDay(p.approved_at)}{p.approved_by_name ? ` by ${p.approved_by_name}` : ""}</p>
				</div>
				<div className="ia-head__side"><AccessBadge status={p.status} /><button type="button" className="ss-btn ss-btn--ghost ss-btn--sm" onClick={onClose}>Close</button></div>
			</div>

			<h3 className="ss-subhead">Access</h3>
			<dl className="ia-summary ia-summary--stack">
				<div className="ia-row"><dt>Status</dt><dd>{p.status === "active" ? "Active: can use telecaller features once they are available" : "Deactivated: no telecaller access"}</dd></div>
				{p.status_changed_at && <div className="ia-row"><dt>Last change</dt><dd>{fmt(p.status_changed_at)}{p.status_changed_by_name ? ` by ${p.status_changed_by_name}` : ""}</dd></div>}
				{p.status_reason && <div className="ia-row"><dt>Reason</dt><dd>{p.status_reason}</dd></div>}
			</dl>
			{!pending ? (
				<div className="ia-actions">
					{p.status === "active" ? (
						<button type="button" className="ss-btn ss-btn--sm ss-btn--danger" disabled={busy} onClick={() => setPending("deactivate")}>Deactivate access</button>
					) : (
						<button type="button" className="ss-btn ss-btn--sm ss-btn--success" disabled={busy} onClick={() => setPending("activate")}>Reactivate access</button>
					)}
				</div>
			) : (
				<div className="ia-confirm" role="alertdialog" aria-labelledby="tc-m-confirm">
					<p id="tc-m-confirm"><strong>{needReason ? "Deactivate this telecaller? They lose telecaller access on their next request. Their account, application and history are kept." : "Reactivate this telecaller? They regain telecaller access."}</strong></p>
					<label className="form-label" htmlFor="tc-m-reason">{needReason ? "Reason (required, shown to the telecaller)" : "Note (optional)"}</label>
					<textarea id="tc-m-reason" className="form-control" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} />
					{needReason && reason.trim().length < 10 && <p className="ss-muted">At least 10 characters.</p>}
					<div className="ia-actions">
						<button type="button" className="ss-btn ss-btn--ghost ss-btn--sm" disabled={busy} onClick={() => setPending(null)}>Cancel</button>
						<button type="button" className={`ss-btn ss-btn--sm ss-btn--${needReason ? "danger" : "success"}`} disabled={busy || (needReason && reason.trim().length < 10)} onClick={post}>Confirm: {needReason ? "Deactivate" : "Reactivate"}</button>
					</div>
				</div>
			)}

			{a ? (
				<>
					<div className="ia-cols">
						<div>
							<h3 className="ss-subhead">Profile</h3>
							<Facts a={a} />
						</div>
						<div>
							<h3 className="ss-subhead">Resume versions (private)</h3>
							<ResumeVersions attempts={a.attempts} />
						</div>
					</div>
					<h3 className="ss-subhead">Application history by attempt</h3>
					<AttemptHistory attempts={a.attempts} />
				</>
			) : (
				<p className="ss-muted">The original application record is not available.</p>
			)}
		</section>
	);
};

const MembersBoard = () => {
	const router = useRouter();
	const [list, setList] = useState(null);
	const [error, setError] = useState("");
	const [q, setQ] = useState("");
	const [status, setStatus] = useState("");
	const [page, setPage] = useState(1);
	const [open, setOpen] = useState(null);

	useEffect(() => {
		if (router.isReady && router.query.open) setOpen(String(router.query.open));
	}, [router.isReady, router.query.open]);

	const load = useCallback(async () => {
		try {
			const { data } = await axios.get(API, { params: { q, status, page } });
			setList(data);
			setError("");
		} catch (e) {
			setError(msg(e));
		}
	}, [q, status, page]);
	useEffect(() => {
		const t = setTimeout(load, q ? 250 : 0);
		return () => clearTimeout(t);
	}, [load, q]);

	return (
		<>
			{list && (
				<div className="ia-cards">
					{[["active", "Active", "ri-user-follow-line"], ["inactive", "Deactivated", "ri-user-unfollow-line"]].map(([k, label, icon]) => (
						<button key={k} type="button" className={`ia-card-stat ${status === k ? "is-active" : ""}`} aria-pressed={status === k} onClick={() => { setStatus(status === k ? "" : k); setPage(1); }}>
							<i className={icon} aria-hidden="true"></i><strong>{list.counts[k]}</strong><span>{label}</span>
						</button>
					))}
				</div>
			)}
			<div className="ia-filters">
				<label className="visually-hidden" htmlFor="tcm-q">Search by name or email</label>
				<input id="tcm-q" className="form-control" type="search" placeholder="Search by name or email" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
				<label className="visually-hidden" htmlFor="tcm-s">Access</label>
				<select id="tcm-s" className="form-control" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
					<option value="">All approved telecallers</option>
					<option value="active">Active</option>
					<option value="inactive">Deactivated</option>
				</select>
			</div>

			{open && <Detail id={open} onChanged={load} onClose={() => setOpen(null)} />}

			<ListState
				error={error}
				loading={!list}
				onRetry={load}
				empty={list && list.members.length === 0}
				emptyTitle={q || status ? "No telecallers found" : "No approved telecallers yet"}
				emptyText={q || status ? "Try a different search or filter." : "Approve an application under Applications and the telecaller appears here."}
			>
				{list && (
					<>
						<div className="table-responsive">
							<table className="table align-middle table-hover fs-14">
								<caption className="visually-hidden">Approved telecallers</caption>
								<thead><tr><th scope="col">Telecaller</th><th scope="col">Phone</th><th scope="col">Location</th><th scope="col">Approved</th><th scope="col">Access</th><th scope="col">Last change</th><th scope="col"><span className="visually-hidden">Action</span></th></tr></thead>
								<tbody>
									{list.members.map((m) => (
										<tr key={m.user_id} className={open === m.user_id ? "table-active" : ""}>
											<td><strong>{m.name}</strong><br /><span className="ss-muted">{m.email}</span></td>
											<td>{m.phone || "–"}</td>
											<td>{[m.city, m.state].filter(Boolean).join(", ") || "–"}</td>
											<td>{fmtDay(m.approved_at)}</td>
											<td><AccessBadge status={m.status} /></td>
											<td>{m.status_changed_at ? fmtDay(m.status_changed_at) : "–"}{m.status_reason && m.status === "inactive" ? <><br /><span className="ss-muted">{m.status_reason}</span></> : null}</td>
											<td><button type="button" className="ss-btn ss-btn--sm ss-btn--ghost" onClick={() => { setOpen(m.user_id); window.scrollTo && window.scrollTo({ top: 0, behavior: "smooth" }); }}>View profile</button></td>
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

export default MembersBoard;
