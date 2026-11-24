import React, { useCallback, useEffect, useState } from "react";
import axios from "axios";
import MeetingDetail, { adminApi } from "@/components/Telecaller/MeetingDetail";
import { msg, fmt, viewerZone, FollowupBadge, MeetingBadge, FOLLOW_UP_LABEL, OUTCOME_LABEL, FILTER_LABEL, eventText, Empty } from "@/components/Telecaller/shared";

// Admin > Telecallers > Activity & Call History. Admin only: every call goes through /api/admin/telecallers/activity, which re-reads the
// admin role from the database. It does not duplicate the Meeting Requests page: it shows follow-up work (calls, ownership, status),
// and ownership overrides need a reason.
const API = "/api/admin/telecallers/activity";
const STATUSES = ["not_contacted", "contacted", "follow_up_required", "meeting_confirmed", "not_interested", "unable_to_reach", "completed"];

const Pager = ({ page, pages, set }) =>
	pages > 1 ? (
		<nav className="ia-pager" aria-label="Pagination">
			<button type="button" className="ss-btn ss-btn--ghost ss-btn--sm" disabled={page <= 1} onClick={() => set(page - 1)}>Previous</button>
			<span>Page {page} of {pages}</span>
			<button type="button" className="ss-btn ss-btn--ghost ss-btn--sm" disabled={page >= pages} onClick={() => set(page + 1)}>Next</button>
		</nav>
	) : null;

const Feed = ({ onOpen, refreshKey }) => {
	const [tz] = useState(viewerZone);
	const [f, setF] = useState({ telecaller: "", meeting: "", from: "", to: "", status: "", type: "all" });
	const [page, setPage] = useState(1);
	const [data, setData] = useState(null);
	const [error, setError] = useState("");
	const set = (k) => (e) => { setF({ ...f, [k]: e.target.value }); setPage(1); };

	const load = useCallback(async () => {
		try {
			setData((await axios.get(API, { params: { view: "feed", ...f, page, tz } })).data);
			setError("");
		} catch (e) {
			setError(msg(e));
		}
	}, [f, page, tz]);
	useEffect(() => {
		const t = setTimeout(load, f.meeting ? 300 : 0);
		return () => clearTimeout(t);
	}, [load, f.meeting, refreshKey]);

	return (
		<>
			<div className="ia-filters" role="search" aria-label="Filter activity">
				<select className="form-control" aria-label="Telecaller" value={f.telecaller} onChange={set("telecaller")}>
					<option value="">All telecallers</option>
					{(data ? data.telecallers : []).map((t) => <option key={t.user_id} value={t.user_id}>{t.name}{t.status === "inactive" ? " (inactive)" : ""}</option>)}
				</select>
				<input className="form-control" type="search" aria-label="Meeting reference or id" placeholder="Meeting reference" value={f.meeting} onChange={set("meeting")} />
				<select className="form-control" aria-label="Follow-up status" value={f.status} onChange={set("status")}>
					<option value="">Any follow-up status</option>
					{STATUSES.map((s) => <option key={s} value={s}>{FOLLOW_UP_LABEL[s]}</option>)}
				</select>
				<select className="form-control" aria-label="Type" value={f.type} onChange={set("type")}>
					<option value="all">Calls and ownership</option><option value="calls">Calls only</option><option value="ownership">Ownership and status only</option>
				</select>
				<label style={{ display: "flex", gap: 6, alignItems: "center" }}>From <input className="form-control" type="date" value={f.from} onChange={set("from")} /></label>
				<label style={{ display: "flex", gap: 6, alignItems: "center" }}>To <input className="form-control" type="date" value={f.to} onChange={set("to")} /></label>
			</div>
			{error && <div className="ss-alert ss-alert--danger" role="alert">{error} <button type="button" className="ss-link-btn" onClick={load}>Try again</button></div>}
			{!data && !error && <p className="ss-muted" role="status">Loading…</p>}
			{data && data.items.length === 0 && <Empty title="No activity found" text={Object.values(f).some((v) => v && v !== "all") ? "Try different filters." : "Calls, follow-ups and ownership changes appear here once telecallers start working on meeting requests."} />}
			{data && data.items.length > 0 && (
				<>
					<div className="table-responsive">
						<table className="table align-middle fs-14">
							<caption className="visually-hidden">Telecaller activity, newest first</caption>
							<thead><tr><th scope="col">When</th><th scope="col">Who</th><th scope="col">Meeting</th><th scope="col">What happened</th></tr></thead>
							<tbody>
								{data.items.map((it) => (
									<tr key={`${it.kind}-${it.id}`}>
										<td style={{ whiteSpace: "nowrap" }}>{fmt(it.at)}</td>
										<td>{it.who}</td>
										<td><button type="button" className="ss-link-btn" onClick={() => onOpen(it.meeting_id)}>{it.customer_name || it.meeting_reference}</button><br /><span className="ss-muted">{it.meeting_reference}</span></td>
										<td style={{ overflowWrap: "anywhere", minWidth: 220 }}>
											{it.kind === "call" ? (
												<>
													<strong>Call: {OUTCOME_LABEL[it.call.outcome] || it.call.outcome}</strong> <span className="ss-muted">({it.call.answered ? "answered" : "not answered"})</span>
													<div style={{ whiteSpace: "pre-wrap" }}>{it.call.notes}</div>
													{it.call.next_follow_up_at && <div className="ss-muted">Next follow-up {fmt(it.call.next_follow_up_at)}</div>}
												</>
											) : (
												<>
													<strong>{eventText(it.event)}</strong>
													{it.event.reason && <div className="ss-muted">Reason: {it.event.reason}</div>}
												</>
											)}
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
					<Pager page={data.page} pages={data.pages} set={setPage} />
				</>
			)}
		</>
	);
};

const Ownership = ({ onOpen, refreshKey }) => {
	const [tz] = useState(viewerZone);
	const [filter, setFilter] = useState("all");
	const [q, setQ] = useState("");
	const [page, setPage] = useState(1);
	const [data, setData] = useState(null);
	const [error, setError] = useState("");
	const load = useCallback(async () => {
		try {
			setData((await axios.get(API, { params: { view: "ownership", filter, q, page, tz } })).data);
			setError("");
		} catch (e) {
			setError(msg(e));
		}
	}, [filter, q, page, tz]);
	useEffect(() => {
		const t = setTimeout(load, q ? 250 : 0);
		return () => clearTimeout(t);
	}, [load, q, refreshKey]);
	return (
		<>
			<div className="tc-tabs" role="group" aria-label="Filter ownership">
				{["all", "unclaimed", "due_today", "overdue", "completed"].map((k) => <button key={k} type="button" aria-pressed={filter === k} onClick={() => { setFilter(k); setPage(1); }}>{FILTER_LABEL[k]}</button>)}
			</div>
			<div className="ia-filters"><input className="form-control" type="search" aria-label="Search" placeholder="Search name, phone, email or reference" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} /></div>
			{error && <div className="ss-alert ss-alert--danger" role="alert">{error}</div>}
			{!data && !error && <p className="ss-muted" role="status">Loading…</p>}
			{data && data.meetings.length === 0 && <Empty title="No meetings found" text="Try a different filter." />}
			{data && data.meetings.length > 0 && (
				<>
					<div className="table-responsive">
						<table className="table align-middle fs-14">
							<caption className="visually-hidden">Follow-up ownership</caption>
							<thead><tr><th scope="col">Customer</th><th scope="col">Follow-up</th><th scope="col">Owner</th><th scope="col">Last call</th><th scope="col">Next follow-up</th><th scope="col"><span className="visually-hidden">Action</span></th></tr></thead>
							<tbody>
								{data.meetings.map((r) => (
									<tr key={r.meeting.id}>
										<td><strong>{r.meeting.name}</strong><br /><span className="ss-muted">{r.meeting.reference}</span></td>
										<td><FollowupBadge status={r.followup.status} /><br /><MeetingBadge status={r.meeting.status} /></td>
										<td>{r.followup.owner_name || <span className="ss-muted">Unclaimed</span>}</td>
										<td>{r.last_call ? `${OUTCOME_LABEL[r.last_call.outcome] || r.last_call.outcome}, ${fmt(r.last_call.called_at)}` : "–"}</td>
										<td>{r.followup.next_follow_up_at ? fmt(r.followup.next_follow_up_at) : "–"}</td>
										<td><button type="button" className="ss-btn ss-btn--sm ss-btn--ghost" onClick={() => onOpen(r.meeting.id)}>Review</button></td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
					<Pager page={data.page} pages={data.pages} set={setPage} />
				</>
			)}
		</>
	);
};

const ActivityBoard = () => {
	const [view, setView] = useState("feed");
	const [open, setOpen] = useState(null);
	const [team, setTeam] = useState([]);
	const [key, setKey] = useState(0);
	useEffect(() => {
		axios.get(API, { params: { view: "feed", page: 1 } }).then((r) => setTeam(r.data.telecallers || [])).catch(() => {});
	}, []);
	const show = (id) => { setOpen(id); window.scrollTo && window.scrollTo({ top: 0, behavior: "smooth" }); };
	return (
		<>
			<div className="tc-tabs" role="tablist" aria-label="Activity views">
				<button type="button" role="tab" aria-selected={view === "feed"} onClick={() => setView("feed")}>Activity feed</button>
				<button type="button" role="tab" aria-selected={view === "ownership"} onClick={() => setView("ownership")}>Follow-up ownership</button>
			</div>
			{open && <MeetingDetail id={open} api={adminApi} mode="admin" team={team} onChanged={() => setKey((k) => k + 1)} onClose={() => setOpen(null)} />}
			{view === "feed" ? <Feed onOpen={show} refreshKey={key} /> : <Ownership onOpen={show} refreshKey={key} />}
		</>
	);
};

export default ActivityBoard;
