import React, { useCallback, useEffect, useRef, useState } from "react";
import axios from "axios";
import toast from "react-hot-toast";
import { msg, fieldErrors, fmt, localToIso, FollowupBadge, MeetingBadge, FOLLOW_UP_LABEL, OUTCOME_LABEL, INTEREST_LABEL, PURPOSE_LABEL, eventText } from "./shared";

// One meeting for a telecaller (and, with mode="admin", for Admin > Telecallers > Activity). The customer's request is shown read-only:
// there is no control here that approves, rejects, reschedules or cancels it, or edits the enquiry. What the viewer can do comes from
// the server (`can`), and the server re-checks every action.
//   api.get()           -> the meeting
//   api.post(payload)   -> an action, answered with the updated meeting
const STATUS_CHOICES = ["not_contacted", "contacted", "follow_up_required", "meeting_confirmed", "not_interested", "unable_to_reach", "completed"];
const CALL_STATUS_CHOICES = STATUS_CHOICES.filter((s) => s !== "completed");

const Row = ({ k, children }) => (children ? <div className="ia-row"><dt>{k}</dt><dd>{children}</dd></div> : null);
const Err = ({ e, k }) => (e[k] ? <span className="tc-error" role="alert">{e[k]}</span> : null);

const MeetingDetail = ({ id, api, mode = "telecaller", team = [], onChanged, onClose }) => {
	const [d, setD] = useState(null);
	const [error, setError] = useState("");
	const [errs, setErrs] = useState({});
	const [busy, setBusy] = useState(false);
	const busyRef = useRef(false);
	const [panel, setPanel] = useState(null); // transfer | assign | clear
	const [own, setOwn] = useState({ to_user_id: "", reason: "" });
	const [call, setCall] = useState({ called_at: "", answered: "", outcome: "", interest: "", notes: "", next_follow_up_at: "", follow_up_status_after: "", confirmation_details: "" });
	const [st, setSt] = useState({ status: "", next_follow_up_at: "", note: "" });

	const load = useCallback(async () => {
		try {
			const data = await api.get(id);
			setD(data);
			setSt((s) => ({ ...s, status: data.followup.status }));
			setError("");
		} catch (e) {
			setError(msg(e));
		}
	}, [api, id]);
	useEffect(() => {
		setD(null);
		setPanel(null);
		setErrs({});
		load();
	}, [load]);

	// One action at a time; on a conflict the screen reloads so nobody keeps working on stale state.
	const act = async (payload, done) => {
		if (busyRef.current) return;
		busyRef.current = true;
		setBusy(true);
		setErrs({});
		try {
			const data = await api.post(id, { ...payload, version: d.followup.version });
			setD(data);
			setSt({ status: data.followup.status, next_follow_up_at: "", note: "" });
			toast.success(done);
			setPanel(null);
			setOwn({ to_user_id: "", reason: "" });
			onChanged && onChanged();
			return true;
		} catch (e) {
			setErrs(fieldErrors(e));
			toast.error(msg(e));
			if (e.response && e.response.status === 409) load();
		} finally {
			busyRef.current = false;
			setBusy(false);
		}
	};

	if (error && !d) return <div className="ss-alert ss-alert--danger" role="alert">{error} <button type="button" className="ss-link-btn" onClick={load}>Try again</button></div>;
	if (!d) return <p className="ss-muted" role="status">Loading meeting…</p>;
	const { meeting: m, followup: f, can } = d;
	const targets = team.filter((t) => t.status === "active" && t.user_id !== f.owner_user_id);

	const submitCall = async (e) => {
		e.preventDefault();
		const ok = await act({ action: "call", called_at: localToIso(call.called_at) || undefined, answered: call.answered === "" ? undefined : call.answered === "yes", outcome: call.outcome, interest: call.interest, notes: call.notes, next_follow_up_at: localToIso(call.next_follow_up_at), follow_up_status_after: call.follow_up_status_after, confirmation_details: call.confirmation_details }, "Call recorded.");
		if (ok) setCall({ called_at: "", answered: "", outcome: "", interest: "", notes: "", next_follow_up_at: "", follow_up_status_after: "", confirmation_details: "" });
	};

	return (
		<section className="tc-detail" aria-label={`Meeting ${m.reference}`}>
			<div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
				<div style={{ minWidth: 0 }}>
					<h2 style={{ margin: 0, fontSize: "1.25rem", overflowWrap: "anywhere" }}>{m.name}</h2>
					<p className="ss-muted" style={{ margin: "2px 0 0" }}>{m.reference} · requested {fmt(m.requested_at)}</p>
				</div>
				<div className="tc-badges" style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "flex-start" }}>
					<FollowupBadge status={f.status} />
					<MeetingBadge status={m.status} />
					{onClose && <button type="button" className="ss-btn ss-btn--ghost ss-btn--sm" onClick={onClose}>Close</button>}
				</div>
			</div>

			<div className="tc-cols" style={{ marginTop: 14 }}>
				<div>
					<h3 style={{ fontSize: "1rem" }}>Customer and original request</h3>
					<dl className="ia-summary ia-summary--stack">
						<Row k="Phone">{m.phone ? <a href={`tel:${m.phone}`}>{m.phone}</a> : null}</Row>
						<Row k="Email">{m.email ? <a href={`mailto:${m.email}`}>{m.email}</a> : null}</Row>
						<Row k="Organisation">{m.organization}</Row>
						<Row k="Purpose">{PURPOSE_LABEL[m.purpose] || m.purpose}</Row>
						<Row k="Requested for">{`${fmt(m.requested_at, m.time_zone)} (${m.time_zone})`}</Row>
						<Row k="Message"><span className="ia-pre" style={{ whiteSpace: "pre-wrap" }}>{m.message}</span></Row>
						{m.confirmed_start && <Row k="Confirmed for">{fmt(m.confirmed_start, m.time_zone)}</Row>}
					</dl>
					<p className="ss-muted" style={{ fontSize: "var(--ss-fs-xs)" }}>The meeting request itself is managed by administrators (Admin &gt; Meeting Requests). Telecallers cannot approve, reschedule, cancel or edit it.</p>
				</div>
				<div>
					<h3 style={{ fontSize: "1rem" }}>Follow-up</h3>
					<dl className="ia-summary ia-summary--stack">
						<Row k="Current owner">{f.owner_name || "Unclaimed"}</Row>
						<Row k="Owned since">{f.owned_at ? fmt(f.owned_at) : null}</Row>
						<Row k="Last contact">{f.last_contacted_at ? fmt(f.last_contacted_at) : "No calls yet"}</Row>
						<Row k="Next follow-up">{f.next_follow_up_at ? fmt(f.next_follow_up_at) : "Not set"}</Row>
						{f.completed_at && <Row k="Completed">{`${fmt(f.completed_at)}${f.completed_by_name ? ` by ${f.completed_by_name}` : ""}${f.completion_note ? ` — ${f.completion_note}` : ""}`}</Row>}
					</dl>

					<div style={{ display: "flex", gap: 8, flexWrap: "wrap", margin: "8px 0" }}>
						{can.claim && <button type="button" className="ss-btn ss-btn--primary" disabled={busy} onClick={() => act({ action: "claim" }, "You now handle this follow-up.")}>Claim this follow-up</button>}
						{can.transfer && mode === "telecaller" && <button type="button" className="ss-btn ss-btn--ghost" onClick={() => setPanel(panel === "transfer" ? null : "transfer")}>Transfer…</button>}
						{can.admin_assign && <button type="button" className="ss-btn ss-btn--ghost" onClick={() => setPanel(panel === "assign" ? null : "assign")}>{f.owner_user_id ? "Reassign…" : "Assign…"}</button>}
						{can.admin_clear && <button type="button" className="ss-btn ss-btn--ghost ss-btn--danger" onClick={() => setPanel(panel === "clear" ? null : "clear")}>Clear ownership…</button>}
					</div>
					{!can.claim && !f.owner_user_id && mode === "telecaller" && <p className="ss-muted">This follow-up is closed.</p>}
					{mode === "telecaller" && f.owner_user_id && !can.change_status && <p className="ss-muted">{f.owner_name} handles this follow-up. You can see the meeting and its call history; ask them or an administrator to transfer it if you need to take over.</p>}

					{panel && (
						<form onSubmit={(e) => { e.preventDefault(); act({ action: panel === "clear" ? "clear" : mode === "admin" ? "assign" : "transfer", to_user_id: own.to_user_id, reason: own.reason }, panel === "clear" ? "Ownership cleared." : "Ownership changed."); }} aria-label="Change ownership">
							{panel !== "clear" && (
								<label>
									{panel === "transfer" ? "Transfer to" : "Assign to"}
									<select className="form-control" value={own.to_user_id} onChange={(e) => setOwn({ ...own, to_user_id: e.target.value })} required>
										<option value="">Choose an active telecaller…</option>
										{targets.map((t) => <option key={t.user_id} value={t.user_id}>{t.name}</option>)}
									</select>
									<Err e={errs} k="to_user_id" />
								</label>
							)}
							<label>
								Reason (required)
								<textarea className="form-control" rows={2} maxLength={500} value={own.reason} onChange={(e) => setOwn({ ...own, reason: e.target.value })} required />
								<Err e={errs} k="reason" />
							</label>
							<div><button type="submit" className="ss-btn ss-btn--primary" disabled={busy}>{panel === "clear" ? "Clear ownership" : "Confirm"}</button></div>
						</form>
					)}
				</div>
			</div>

			{can.change_status && (
				<div className="tc-cols" style={{ marginTop: 16 }}>
					{can.record_call && (
						<div>
							<h3 style={{ fontSize: "1rem" }}>Record a call</h3>
							<form onSubmit={submitCall} aria-label="Record a call">
								<div className="tc-row">
									<label>Answered?
										<select className="form-control" value={call.answered} onChange={(e) => setCall({ ...call, answered: e.target.value })} required>
											<option value="">Choose…</option><option value="yes">Yes</option><option value="no">No</option>
										</select><Err e={errs} k="answered" />
									</label>
									<label>Outcome
										<select className="form-control" value={call.outcome} onChange={(e) => setCall({ ...call, outcome: e.target.value })} required>
											<option value="">Choose…</option>
											{Object.entries(OUTCOME_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
										</select><Err e={errs} k="outcome" />
									</label>
								</div>
								<div className="tc-row">
									<label>Interest
										<select className="form-control" value={call.interest} onChange={(e) => setCall({ ...call, interest: e.target.value })}>
											<option value="">Not recorded</option>
											{Object.entries(INTEREST_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
										</select><Err e={errs} k="interest" />
									</label>
									<label>Follow-up status after the call
										<select className="form-control" value={call.follow_up_status_after} onChange={(e) => setCall({ ...call, follow_up_status_after: e.target.value })}>
											<option value="">Keep ({FOLLOW_UP_LABEL[f.status]})</option>
											{CALL_STATUS_CHOICES.map((s) => <option key={s} value={s}>{FOLLOW_UP_LABEL[s]}</option>)}
										</select><Err e={errs} k="follow_up_status_after" />
									</label>
								</div>
								<label>Call note
									<textarea className="form-control" rows={3} maxLength={2000} value={call.notes} onChange={(e) => setCall({ ...call, notes: e.target.value })} required />
									<Err e={errs} k="notes" />
								</label>
								<div className="tc-row">
									<label>Next follow-up (optional)
										<input className="form-control" type="datetime-local" value={call.next_follow_up_at} onChange={(e) => setCall({ ...call, next_follow_up_at: e.target.value })} />
										<Err e={errs} k="next_follow_up_at" />
									</label>
									<label>Call time (blank = now)
										<input className="form-control" type="datetime-local" value={call.called_at} onChange={(e) => setCall({ ...call, called_at: e.target.value })} />
										<Err e={errs} k="called_at" />
									</label>
								</div>
								<label>Meeting confirmation details (optional)
									<textarea className="form-control" rows={2} maxLength={2000} value={call.confirmation_details} onChange={(e) => setCall({ ...call, confirmation_details: e.target.value })} />
								</label>
								<p className="ss-muted" style={{ fontSize: "var(--ss-fs-xs)", margin: 0 }}>A call is added to the history and cannot be edited later. Leaving the next follow-up empty clears the previous reminder.</p>
								<div><button type="submit" className="ss-btn ss-btn--primary" disabled={busy}>Save call</button></div>
							</form>
						</div>
					)}
					<div>
						<h3 style={{ fontSize: "1rem" }}>Follow-up status</h3>
						<form onSubmit={(e) => { e.preventDefault(); act({ action: "status", status: st.status, next_follow_up_at: localToIso(st.next_follow_up_at), note: st.note }, "Follow-up updated."); }} aria-label="Update follow-up status">
							<label>Status
								<select className="form-control" value={st.status} onChange={(e) => setSt({ ...st, status: e.target.value })}>
									{STATUS_CHOICES.map((s) => <option key={s} value={s}>{FOLLOW_UP_LABEL[s]}</option>)}
								</select><Err e={errs} k="status" />
							</label>
							<label>Next follow-up (optional)
								<input className="form-control" type="datetime-local" value={st.next_follow_up_at} onChange={(e) => setSt({ ...st, next_follow_up_at: e.target.value })} />
								<Err e={errs} k="next_follow_up_at" />
							</label>
							<label>{st.status === "completed" ? "Outcome note (required to complete)" : "Note (optional)"}
								<textarea className="form-control" rows={2} maxLength={500} value={st.note} onChange={(e) => setSt({ ...st, note: e.target.value })} />
								<Err e={errs} k="note" />
							</label>
							<p className="ss-muted" style={{ fontSize: "var(--ss-fs-xs)", margin: 0 }}>This is the follow-up status only. It never changes the meeting request, and nothing is completed automatically when a meeting time passes.</p>
							<div><button type="submit" className="ss-btn ss-btn--ghost" disabled={busy}>Update status</button></div>
						</form>
					</div>
				</div>
			)}

			<div className="tc-cols" style={{ marginTop: 16 }}>
				<div>
					<h3 style={{ fontSize: "1rem" }}>Call history ({d.calls.length})</h3>
					{d.calls.length === 0 ? <p className="ss-muted">No calls recorded yet.</p> : d.calls.map((c) => (
						<div className="tc-callitem" key={c.id}>
							<strong>{OUTCOME_LABEL[c.outcome] || c.outcome}</strong> <span className="ss-muted">· {c.answered ? "answered" : "not answered"}{c.interest ? ` · interest ${INTEREST_LABEL[c.interest].toLowerCase()}` : ""}</span>
							<div className="ss-muted">{fmt(c.called_at)} · {c.telecaller_name}{c.follow_up_status_after ? ` · status → ${FOLLOW_UP_LABEL[c.follow_up_status_after]}` : ""}</div>
							<div>{c.notes}</div>
							{c.confirmation_details && <div className="ss-muted">Confirmation: {c.confirmation_details}</div>}
							{c.next_follow_up_at && <div className="ss-muted">Next follow-up set for {fmt(c.next_follow_up_at)}</div>}
						</div>
					))}
				</div>
				<div>
					<h3 style={{ fontSize: "1rem" }}>Ownership and status history</h3>
					{d.events.length === 0 ? <p className="ss-muted">No changes yet.</p> : (
						<ol className="ia-timeline">
							{d.events.map((e) => (
								<li key={e.id}>
									<strong>{eventText(e)}</strong> <span className="ss-muted">{fmt(e.at)}</span>
									{e.reason && <p className="ss-muted" style={{ margin: 0 }}>Reason: {e.reason}</p>}
								</li>
							))}
						</ol>
					)}
				</div>
			</div>
		</section>
	);
};

export const telecallerApi = {
	get: async (id) => (await axios.get(`/api/telecaller/meetings/${id}`)).data,
	post: async (id, payload) => (await axios.post(`/api/telecaller/meetings/${id}`, payload)).data,
};
export const adminApi = {
	get: async (id) => (await axios.get("/api/admin/telecallers/activity", { params: { id } })).data,
	post: async (id, payload) => (await axios.post("/api/admin/telecallers/activity", { ...payload, id })).data,
};

export default MeetingDetail;
