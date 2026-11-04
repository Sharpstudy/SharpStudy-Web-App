import React, { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/router";
import axios from "axios";
import MeetingDetail, { telecallerApi } from "./MeetingDetail";
import NotificationList from "@/components/Notifications/NotificationList";
import { msg, fmt, viewerZone, FollowupBadge, MeetingBadge, FILTER_LABEL, OUTCOME_LABEL, PURPOSE_LABEL, Empty } from "./shared";

// Telecaller dashboard. Every number comes from /api/telecaller/summary (exact database counts); the list from /api/telecaller/meetings.
// Access is enforced by those APIs from the database on every request; this screen only shows what they return.
const FILTERS = ["all", "unclaimed", "mine", "due_today", "overdue", "completed"];

const Tile = ({ icon, value, label, hint, onClick, active }) => {
	const inner = (
		<>
			<i className={icon} aria-hidden="true"></i>
			<strong>{value}</strong>
			<span>{label}{hint ? ` · ${hint}` : ""}</span>
		</>
	);
	return onClick ? <button type="button" className={`ia-card-stat ${active ? "is-active" : ""}`} aria-pressed={!!active} onClick={onClick}>{inner}</button> : <div className="ia-card-stat">{inner}</div>;
};

const ReminderList = ({ title, tone, group, onOpen, empty }) => (
	<div className={`tc-panel ${tone ? `tc-panel--${tone}` : ""}`}>
		<h3>{title} <span className="ss-muted">({group.total})</span></h3>
		{group.items.length === 0 ? <p className="ss-muted" style={{ margin: 0 }}>{empty}</p> : (
			<ul>
				{group.items.map((r) => (
					<li key={r.meeting.id}>
						<button type="button" className="ss-link-btn" onClick={() => onOpen(r.meeting.id)}>{r.meeting.name}</button>
						<div className="ss-muted" style={{ fontSize: "var(--ss-fs-xs)" }}>{r.meeting.reference} · {fmt(r.followup.next_follow_up_at)}</div>
					</li>
				))}
				{group.total > group.items.length && <li className="ss-muted" style={{ fontSize: "var(--ss-fs-xs)" }}>and {group.total - group.items.length} more in the list below</li>}
			</ul>
		)}
	</div>
);

const Dashboard = () => {
	const router = useRouter();
	const [tz] = useState(viewerZone);
	const [sum, setSum] = useState(null);
	const [list, setList] = useState(null);
	const [team, setTeam] = useState([]);
	const [error, setError] = useState("");
	const [filter, setFilter] = useState("all");
	const [mine, setMine] = useState(false);
	const [q, setQ] = useState("");
	const [page, setPage] = useState(1);
	const [open, setOpen] = useState(null);
	const [denied, setDenied] = useState("");

	useEffect(() => {
		if (router.isReady && router.query.open) setOpen(String(router.query.open));
	}, [router.isReady, router.query.open]);

	const loadSummary = useCallback(async () => {
		try {
			setSum((await axios.get("/api/telecaller/summary", { params: { tz } })).data);
		} catch (e) {
			if (e.response && [401, 403].includes(e.response.status)) setDenied(msg(e));
			else setError(msg(e));
		}
	}, [tz]);
	const loadList = useCallback(async () => {
		try {
			setList((await axios.get("/api/telecaller/meetings", { params: { filter, mine: mine ? 1 : undefined, q, page, tz } })).data);
			setError("");
		} catch (e) {
			if (e.response && [401, 403].includes(e.response.status)) setDenied(msg(e));
			else setError(msg(e));
		}
	}, [filter, mine, q, page, tz]);
	const refresh = useCallback(() => {
		loadSummary();
		loadList();
	}, [loadSummary, loadList]);

	useEffect(() => {
		loadSummary();
		axios.get("/api/telecaller/team").then((r) => setTeam(r.data.telecallers)).catch(() => {});
	}, [loadSummary]);
	useEffect(() => {
		const t = setTimeout(loadList, q ? 250 : 0);
		return () => clearTimeout(t);
	}, [loadList, q]);

	if (denied) return <div className="ss-alert ss-alert--danger" role="alert"><strong>Access denied.</strong> {denied}</div>;
	const c = sum && sum.counts;
	const pick = (f) => { setFilter(f); setPage(1); };

	return (
		<>
			{/* The same notifications section students see (heading, unread count, messages, links, Mark all read): it renders nothing when there are none. */}
			<NotificationList limit={5} />
			{c && (
				<div className="ia-cards" aria-label="Follow-up summary">
					<Tile icon="ri-calendar-event-line" value={c.total} label="Meeting requests" onClick={() => pick("all")} active={filter === "all"} />
					<Tile icon="ri-user-add-line" value={c.unclaimed} label="Unclaimed" onClick={() => pick("unclaimed")} active={filter === "unclaimed"} />
					<Tile icon="ri-user-star-line" value={c.mine} label="My follow-ups" onClick={() => pick("mine")} active={filter === "mine"} />
					<Tile icon="ri-time-line" value={c.due_today} label="Due today" hint={`${c.mine_due_today} mine`} onClick={() => pick("due_today")} active={filter === "due_today"} />
					<Tile icon="ri-alarm-warning-line" value={c.overdue} label="Overdue" hint={`${c.mine_overdue} mine`} onClick={() => pick("overdue")} active={filter === "overdue"} />
					<Tile icon="ri-checkbox-circle-line" value={c.completed} label="Completed" onClick={() => pick("completed")} active={filter === "completed"} />
				</div>
			)}
			{sum && <p className="ss-muted" style={{ fontSize: "var(--ss-fs-xs)" }}>Counts are live totals for the whole team. &ldquo;Due today&rdquo; means the next follow-up is later today and &ldquo;Overdue&rdquo; means its time has passed, in your time zone ({sum.time_zone}). Closed follow-ups (completed or not interested) are never due or overdue.</p>}

			{sum && (
				<div className="tc-reminders" aria-label="My reminders">
					<ReminderList title="My overdue" tone="danger" group={sum.reminders.overdue} onOpen={setOpen} empty="Nothing overdue. Nice." />
					<ReminderList title="My due today" tone="warn" group={sum.reminders.due_today} onOpen={setOpen} empty="Nothing else due today." />
					<ReminderList title="My upcoming (next 7 days)" group={sum.reminders.upcoming} onOpen={setOpen} empty="No upcoming follow-ups scheduled." />
				</div>
			)}

			<div className="tc-tabs" role="group" aria-label="Filter meetings">
				{FILTERS.map((f) => <button key={f} type="button" aria-pressed={filter === f} onClick={() => pick(f)}>{FILTER_LABEL[f]}</button>)}
			</div>
			<div className="ia-filters">
				<label className="visually-hidden" htmlFor="tc-q">Search</label>
				<input id="tc-q" className="form-control" type="search" placeholder="Search name, phone, email or reference" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
				{!["mine"].includes(filter) && <label style={{ display: "flex", alignItems: "center", gap: 6 }}><input type="checkbox" checked={mine} onChange={(e) => { setMine(e.target.checked); setPage(1); }} /> Only mine</label>}
			</div>

			{open && <MeetingDetail id={open} api={telecallerApi} team={team} onChanged={refresh} onClose={() => setOpen(null)} />}

			{error && <div className="ss-alert ss-alert--danger" role="alert">{error} <button type="button" className="ss-link-btn" onClick={refresh}>Try again</button></div>}
			{!list && !error && <p className="ss-muted" role="status">Loading…</p>}
			{list && list.meetings.length === 0 && <Empty title="No meetings found" text={q || mine || filter !== "all" ? "Try a different filter or search." : "Meeting requests from the Talk to our team form appear here."} />}
			{list && list.meetings.length > 0 && (
				<>
					<div className="tc-list">
						{list.meetings.map((r) => (
							<article key={r.meeting.id} className={`tc-card ${open === r.meeting.id ? "is-open" : ""}`}>
								<div className="tc-badges">
									<FollowupBadge status={r.followup.status} />
									<MeetingBadge status={r.meeting.status} />
								</div>
								<h3>{r.meeting.name}</h3>
								<div className="tc-meta">
									<span><i className="ri-phone-line" aria-hidden="true"></i> {r.meeting.phone}</span>
									<span><i className="ri-mail-line" aria-hidden="true"></i> {r.meeting.email}</span>
								</div>
								<div className="tc-meta">
									<span>{PURPOSE_LABEL[r.meeting.purpose] || r.meeting.purpose}</span>
									<span>Requested {fmt(r.meeting.requested_at, r.meeting.time_zone)}</span>
									<span>{r.meeting.reference}</span>
								</div>
								<div className="tc-meta">
									<span>Owner: <strong>{r.followup.owner_name || "Unclaimed"}</strong></span>
									<span>Last call: {r.last_call ? `${OUTCOME_LABEL[r.last_call.outcome] || r.last_call.outcome}, ${fmt(r.last_call.called_at)}` : "none yet"}</span>
									<span>Next follow-up: {r.followup.next_follow_up_at ? fmt(r.followup.next_follow_up_at) : "not set"}</span>
								</div>
								<div className="tc-actions">
									<button type="button" className="ss-btn ss-btn--sm ss-btn--primary" onClick={() => { setOpen(r.meeting.id); window.scrollTo && window.scrollTo({ top: 0, behavior: "smooth" }); }}>Open</button>
								</div>
							</article>
						))}
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

			{sum && (
				<div className="tc-panel" style={{ marginTop: 16 }}>
					<h3>Recent call activity</h3>
					{sum.recent_calls.length === 0 ? <p className="ss-muted" style={{ margin: 0 }}>No calls have been recorded yet.</p> : (
						<ul>
							{sum.recent_calls.map((r) => (
								<li key={r.id}>
									<button type="button" className="ss-link-btn" onClick={() => setOpen(r.meeting_id)}>{r.customer_name || r.meeting_reference}</button>{" "}
									<span className="ss-muted">· {OUTCOME_LABEL[r.outcome] || r.outcome} · {r.answered ? "answered" : "not answered"} · {r.telecaller_name} · {fmt(r.called_at)}</span>
								</li>
							))}
						</ul>
					)}
				</div>
			)}
		</>
	);
};

export default Dashboard;
