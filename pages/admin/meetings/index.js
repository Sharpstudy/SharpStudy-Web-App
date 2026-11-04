import React, { useCallback, useEffect, useRef, useState } from "react";
import Head from "next/head";
import { useRouter } from "next/router";
import axios from "axios";
import toast from "react-hot-toast";
import AdminLayout from "@/components/_App/AdminLayout";
import { EmptyState } from "@/components/ui";
import { PURPOSES } from "@/components/Meetings/MeetingRequestForm";

const STATUS_LABEL = { pending: "Pending", approved: "Approved", rejected: "Rejected", reschedule_requested: "Reschedule requested", cancelled: "Cancelled" };
const PURPOSE_LABEL = Object.fromEntries(PURPOSES.map((p) => [p.value, p.label]));
const fmt = (d, tz) => {
	if (!d) return "–";
	try {
		return new Intl.DateTimeFormat("en-US", { timeZone: tz || "UTC", dateStyle: "medium", timeStyle: "short" }).format(new Date(d)) + (tz ? ` (${tz})` : " UTC");
	} catch (e) {
		return new Date(d).toLocaleString();
	}
};
const msg = (e) => (e.response && e.response.data && e.response.data.message) || "Something went wrong.";
const StatusBadge = ({ status }) => <span className={`ss-badge ss-meeting__status ss-meeting__status--${status}`}>{STATUS_LABEL[status] || status}</span>;

const Detail = ({ id, onChanged, onClose }) => {
	const [data, setData] = useState(null);
	const [error, setError] = useState("");
	const [busy, setBusy] = useState(false);
	const busyRef = useRef(false);
	const [form, setForm] = useState({ notes: "", meetingUrl: "", date: "", time: "" });

	const load = useCallback(async () => {
		try {
			const { data: d } = await axios.get(`/api/admin/meetings/${id}`);
			setData(d);
			setError("");
			const r = d.request;
			setForm({ notes: r.adminNotes || "", meetingUrl: r.meetingUrl || "", date: r.requestedDate, time: r.requestedTime });
		} catch (e) {
			setError(msg(e));
		}
	}, [id]);
	useEffect(() => {
		setData(null);
		load();
	}, [load]);

	if (error && !data) return <p className="ss-meeting__banner" role="alert">{error}</p>;
	if (!data) return <p className="ss-muted" role="status">Loading…</p>;
	const r = data.request;
	const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

	const act = async (action, confirmText) => {
		if (busyRef.current) return; // one change at a time; blocks double clicks
		if (confirmText && !window.confirm(confirmText)) return;
		busyRef.current = true;
		setBusy(true);
		try {
			const body = { action, version: r.version, notes: form.notes, meetingUrl: form.meetingUrl };
			if (action === "approve" || action === "reschedule") {
				body.date = form.date;
				body.time = form.time;
			}
			await axios.post(`/api/admin/meetings/${id}`, body);
			toast.success("Saved.");
			await load();
			onChanged();
		} catch (e) {
			toast.error(msg(e));
			await load(); // show what the other admin did
			onChanged();
		} finally {
			busyRef.current = false;
			setBusy(false);
		}
	};
	const saveNotes = async () => {
		if (busyRef.current) return;
		busyRef.current = true;
		setBusy(true);
		try {
			await axios.post(`/api/admin/meetings/${id}`, { action: "note", notes: form.notes });
			toast.success("Notes saved.");
			await load();
		} catch (e) {
			toast.error(msg(e));
		} finally {
			busyRef.current = false;
			setBusy(false);
		}
	};
	const open = ["pending", "reschedule_requested"].includes(r.status);
	const failed = r.adminEmailStatus === "failed" || r.visitorEmailStatus === "failed";
	const skipped = r.adminEmailStatus === "skipped" || r.visitorEmailStatus === "skipped";
	const emailProblem = failed || skipped;

	return (
		<section className="ss-card ss-meeting-admin__detail" aria-labelledby="md-title">
			<header className="ss-meeting-admin__detailhead">
				<div className="ss-meeting-admin__who">
					<h2 id="md-title">{r.name}</h2>
					<p className="ss-meeting-admin__sub">
						<span className="ss-meeting-admin__ref">{r.reference}</span>
						<StatusBadge status={r.status} />
					</p>
				</div>
				<button type="button" className="ss-btn ss-btn--secondary ss-btn--sm" onClick={onClose} aria-label="Close request details">
					<i className="ri-close-line" aria-hidden="true"></i> Close
				</button>
			</header>

			<div className="ss-meeting-admin__body">
				<dl className="ss-meeting-admin__facts">
					<div><dt>Email</dt><dd><a href={`mailto:${r.email}`}>{r.email}</a></dd></div>
					<div><dt>Phone</dt><dd>{r.phone}</dd></div>
					<div><dt>Organization</dt><dd>{r.organization || "–"}</dd></div>
					<div><dt>Purpose</dt><dd>{PURPOSE_LABEL[r.purpose] || r.purpose}</dd></div>
					<div><dt>Requested</dt><dd>{r.requestedDate} {r.requestedTime}<span className="ss-meeting-admin__tz">{r.timeZone}</span><span className="ss-meeting-admin__tz">{fmt(r.requestedAt, "UTC")}</span></dd></div>
					<div><dt>Confirmed</dt><dd>{r.confirmedStart ? fmt(r.confirmedStart, r.timeZone) : "Not confirmed"}</dd></div>
					{r.proposedStart && <div><dt>Proposed</dt><dd>{fmt(r.proposedStart, r.timeZone)}</dd></div>}
					<div><dt>Submitted</dt><dd>{fmt(r.createdAt, "UTC")}</dd></div>
				</dl>

				{r.message && (
					<div>
						<h3 className="ss-meeting-admin__h">Visitor message</h3>
						<p className="ss-meeting-admin__msg">{r.message}</p>
					</div>
				)}

				{emailProblem && (
					<div className={`ss-meeting-admin__notice ${failed ? "is-failed" : "is-skipped"}`} role="status">
						<i className={failed ? "ri-mail-close-line" : "ri-mail-forbid-line"} aria-hidden="true"></i>
						<div>
							<strong>{failed ? "An e-mail could not be delivered" : "E-mails were not sent"}</strong>
							<p>
								The request is saved and its status is unaffected. Admin notice: {r.adminEmailStatus}. Visitor e-mail: {r.visitorEmailStatus}.
								{r.lastEmailError ? ` (${r.lastEmailError})` : ""}
							</p>
						</div>
						<button type="button" className="ss-btn ss-btn--secondary ss-btn--sm" disabled={busy} onClick={() => act("resend_email")}>Retry sending</button>
					</div>
				)}

				<section aria-labelledby="md-decision">
					<h3 className="ss-meeting-admin__h" id="md-decision">Decision</h3>
					<div className="ss-meeting-admin__form">
						<label>
							<span>Date</span>
							<input type="date" className="form-control" value={form.date} onChange={set("date")} />
						</label>
						<label>
							<span>Time</span>
							<input type="time" className="form-control" value={form.time} onChange={set("time")} />
						</label>
						<label className="ss-meeting__wide">
							<span>Meeting link <em>(shown to the visitor when approved)</em></span>
							<input type="url" className="form-control" placeholder="https://" value={form.meetingUrl} onChange={set("meetingUrl")} maxLength={500} />
						</label>
						<p className="ss-meeting-admin__help ss-meeting__wide">
							Date and time are in the visitor&apos;s time zone ({r.timeZone}). Availability is checked only against meetings already approved here, not against any external calendar.
						</p>
						<label className="ss-meeting__wide">
							<span>Private admin notes <em>(never shown to the visitor)</em></span>
							<textarea className="form-control" rows={4} maxLength={2000} value={form.notes} onChange={set("notes")} />
						</label>
					</div>
					<div className="ss-meeting-admin__actions" aria-busy={busy}>
						{open && (
							<button type="button" className="ss-btn" disabled={busy} onClick={() => act("approve", `Approve ${r.reference} and email ${r.email} the confirmation?`)}>Approve</button>
						)}
						{open && (
							<button type="button" className="ss-btn ss-btn--secondary" disabled={busy} onClick={() => act("reschedule", `Propose ${form.date} ${form.time} (${r.timeZone}) to ${r.email}?`)}>Request reschedule</button>
						)}
						{open && (
							<button type="button" className="ss-btn ss-btn--danger" disabled={busy} onClick={() => act("reject", `Reject ${r.reference}? ${r.email} will be notified.`)}>Reject</button>
						)}
						{r.status === "approved" && (
							<>
								<button type="button" className="ss-btn ss-btn--secondary" disabled={busy} onClick={() => act("reschedule", `Move ${r.reference} to ${form.date} ${form.time} (${r.timeZone}) and ask ${r.email} to accept?`)}>Request reschedule</button>
								<button type="button" className="ss-btn ss-btn--danger" disabled={busy} onClick={() => act("cancel", `Cancel the confirmed meeting ${r.reference}? ${r.email} will be notified.`)}>Cancel meeting</button>
							</>
						)}
						{r.status === "reschedule_requested" && (
							<button type="button" className="ss-btn ss-btn--ghost" disabled={busy} onClick={() => act("cancel", `Cancel ${r.reference}?`)}>Cancel request</button>
						)}
						<button type="button" className="ss-btn ss-btn--ghost ss-meeting-admin__neutral" disabled={busy} onClick={saveNotes}>Save notes only</button>
					</div>
					{!open && r.status !== "approved" && <p className="ss-meeting-admin__help">This request is {STATUS_LABEL[r.status].toLowerCase()} and cannot be changed further.</p>}
				</section>

				<section aria-labelledby="md-history">
					<h3 className="ss-meeting-admin__h" id="md-history">History</h3>
					<ol className="ss-meeting-admin__history">
						{data.events.map((ev, i) => (
							<li key={i}>
								<span className="ss-meeting-admin__dot" aria-hidden="true"></span>
								<div>
									<strong>{ev.from ? `${STATUS_LABEL[ev.from]} → ` : ""}{STATUS_LABEL[ev.to] || ev.to}</strong>
									<span className="ss-meeting-admin__when">{ev.actor} · {fmt(ev.at, "UTC")}</span>
									{ev.note ? <span className="ss-meeting-admin__note">{ev.note}</span> : null}
								</div>
							</li>
						))}
					</ol>
				</section>
			</div>
		</section>
	);
};

// Safe e-mail setup check: shows which settings exist (never values); nothing is sent unless you confirm.
const EmailSetup = () => {
	const [config, setConfig] = useState(null);
	const [msg_, setMsg] = useState("");
	const [busy, setBusy] = useState(false);
	useEffect(() => {
		axios.get("/api/admin/meetings/email-check").then((r) => setConfig(r.data.config)).catch((e) => setMsg(msg(e)));
	}, []);
	const run = async (action, confirmText) => {
		if (busy || (confirmText && !window.confirm(confirmText))) return;
		setBusy(true);
		setMsg("");
		try {
			const { data } = await axios.post("/api/admin/meetings/email-check", { action, confirm: action === "send_test" ? true : undefined });
			setMsg(data.message);
			setConfig(data.config);
		} catch (e) {
			setMsg(msg(e));
		} finally {
			setBusy(false);
		}
	};
	if (!config) return null;
	return (
		<details className="ss-card ss-meeting-admin__email">
			<summary>
				<i className="ri-mail-settings-line" aria-hidden="true"></i>
				<span>E-mail setup</span>
				<span className={`ss-meeting-admin__chip ${config.ready ? "is-ready" : "is-notready"}`}>{config.ready ? "Ready" : "Not ready"}</span>
			</summary>
			<div className="ss-meeting-admin__emailbody">
				<ul className="ss-meeting-admin__checks">
					<li className={config.smtpCredentialsSet ? "is-ok" : "is-missing"}>SMTP credentials: {config.smtpCredentialsSet ? "set" : "missing"}</li>
					<li className={config.adminEmailSet && config.adminEmailMasked ? "is-ok" : "is-missing"}>Admin notification address: {config.adminEmailSet ? config.adminEmailMasked || "invalid" : "missing"}</li>
					{config.problems.map((p) => <li key={p} className="is-missing">{p}</li>)}
				</ul>
				{config.missing.length > 0 && <p className="ss-meeting-admin__help">Set {config.missing.join(", ")} in the server environment. Until then requests are saved but e-mails are skipped.</p>}
				<div className="ss-meeting-admin__actions">
					<button type="button" className="ss-btn ss-btn--secondary ss-btn--sm" disabled={busy} onClick={() => run("verify")}>Check SMTP login</button>
					<button type="button" className="ss-btn ss-btn--ghost ss-btn--sm" disabled={busy || !config.ready} onClick={() => run("send_test", `Send one test e-mail to ${config.adminEmailMasked}?`)}>Send test e-mail</button>
				</div>
				{msg_ && <p className="ss-meeting-admin__result" role="status">{msg_}</p>}
			</div>
		</details>
	);
};

const STATS = [
	{ key: "pending", label: "Pending", icon: "ri-time-line" },
	{ key: "approved", label: "Approved", icon: "ri-calendar-check-line" },
	{ key: "rejected", label: "Rejected", icon: "ri-close-circle-line" },
	{ key: "reschedule_requested", label: "Reschedule requested", icon: "ri-calendar-event-line" },
];

const Meetings = ({ user }) => {
	const router = useRouter();
	const [list, setList] = useState(null);
	const [error, setError] = useState("");
	const [status, setStatus] = useState("");
	const [q, setQ] = useState("");
	const [query, setQuery] = useState("");
	const [page, setPage] = useState(1);
	const [selected, setSelected] = useState(null);

	useEffect(() => {
		const t = setTimeout(() => {
			setQuery(q.trim());
			setPage(1);
		}, 300);
		return () => clearTimeout(t);
	}, [q]);

	const load = useCallback(async () => {
		try {
			const { data } = await axios.get("/api/admin/meetings", { params: { status, q: query, page, pageSize: 10 } });
			setList(data);
			setError("");
		} catch (e) {
			setError(msg(e));
		}
	}, [status, query, page]);
	useEffect(() => {
		load();
	}, [load]);
	useEffect(() => {
		if (router.isReady && typeof router.query.open === "string") setSelected(router.query.open);
	}, [router.isReady, router.query.open]);

	const c = (list && list.counts) || {};
	return (
		<AdminLayout user={user} title="Meeting Requests" description="Review and manage booking requests from the Schedule a call form. Nothing is confirmed until you approve it.">
			<Head>
				<title>Meeting requests — SharpStudy admin</title>
			</Head>
			<div className="ss-meeting-admin__tiles">
				{STATS.map((s) => (
					<div key={s.key} className={`ss-meeting-admin__stat ss-meeting-admin__stat--${s.key}`}>
						<span className="ss-meeting-admin__staticon" aria-hidden="true">
							<i className={s.icon}></i>
						</span>
						<div>
							<div className="ss-meeting-admin__statvalue">{list ? c[s.key] || 0 : "–"}</div>
							<div className="ss-meeting-admin__statlabel">{s.label}</div>
						</div>
					</div>
				))}
			</div>

			<EmailSetup />

			<div className="ss-meeting-admin__filters">
				<div className="ss-meeting-admin__search">
					<i className="ri-search-line" aria-hidden="true"></i>
					<input type="search" className="form-control" placeholder="Search name, email, reference or organization" aria-label="Search meeting requests" value={q} onChange={(e) => setQ(e.target.value)} />
				</div>
				<select className="form-select" aria-label="Filter by status" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
					<option value="">All statuses</option>
					{Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
				</select>
			</div>

			{error && <p className="ss-meeting__banner" role="alert">{error}</p>}
			{selected && <Detail key={selected} id={selected} onChanged={load} onClose={() => setSelected(null)} />}

			{list && list.requests.length === 0 && <EmptyState icon="ri-calendar-line" title="No meeting requests" description={status || query ? "Nothing matches these filters." : "Requests from the Schedule a call form appear here."} />}
			{list && list.requests.length > 0 && (
				<div className="ss-table-wrap ss-meeting-admin__table">
					<table className="ss-table">
						<thead>
							<tr>
								<th className="col-ref">Reference</th>
								<th className="col-visitor">Visitor</th>
								<th className="col-purpose">Purpose</th>
								<th className="col-when">Requested</th>
								<th className="col-status">Status</th>
								<th className="col-action"><span className="visually-hidden">Open</span></th>
							</tr>
						</thead>
						<tbody>
							{list.requests.map((r) => (
								<tr key={r.id} className={selected === r.id ? "is-selected" : ""}>
									<td className="col-ref"><span className="ss-meeting-admin__ref">{r.reference}</span></td>
									<td className="col-visitor"><strong>{r.name}</strong><span className="ss-meeting-admin__cellsub">{r.email}</span></td>
									<td className="col-purpose">{PURPOSE_LABEL[r.purpose] || r.purpose}</td>
									<td className="col-when"><span className="ss-meeting-admin__nowrap">{r.requestedDate} {r.requestedTime}</span><span className="ss-meeting-admin__cellsub">{r.timeZone}</span></td>
									<td className="col-status">
										<StatusBadge status={r.status} />
										{(r.adminEmailStatus === "failed" || r.visitorEmailStatus === "failed") && <span className="ss-badge ss-badge--danger ss-meeting-admin__mailfail" title={r.lastEmailError || "Email failed"}>Email failed</span>}
									</td>
									<td className="col-action"><button type="button" className="ss-btn ss-btn--secondary ss-btn--sm" aria-label={`Review request ${r.reference} from ${r.name}`} onClick={() => setSelected(r.id)}>Review</button></td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			)}
			{list && list.pages > 1 && (
				<nav className="ss-meeting-admin__pager" aria-label="Pagination">
					<button type="button" className="ss-btn ss-btn--secondary ss-btn--sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button>
					<span>Page {list.page} of {list.pages} · {list.total} requests</span>
					<button type="button" className="ss-btn ss-btn--secondary ss-btn--sm" disabled={page >= list.pages} onClick={() => setPage(page + 1)}>Next</button>
				</nav>
			)}
		</AdminLayout>
	);
};

export default Meetings;
