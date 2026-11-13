import React from "react";

// Display helpers shared by the telecaller dashboard and Admin > Telecallers > Activity & Call History.
// Everything here is display: every read and every change goes through the follow-up APIs, which authorise each call on the server.

export const msg = (e) => (e && e.response && e.response.data && e.response.data.message) || "Something went wrong.";
export const fieldErrors = (e) => (e && e.response && e.response.data && e.response.data.fields) || {};
export const fmt = (d, tz) => (d ? new Date(d).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short", ...(tz ? { timeZone: tz } : {}) }) : "–");
export const fmtDay = (d) => (d ? new Date(d).toLocaleDateString(undefined, { dateStyle: "medium" }) : "–");
// The viewer's own IANA zone: only used so the server can decide what "today" means for them.
export const viewerZone = () => {
	try {
		return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
	} catch (e) {
		return "UTC";
	}
};
// <input type="datetime-local"> gives a local wall-clock string; the API wants an absolute instant.
export const localToIso = (v) => (v ? new Date(v).toISOString() : "");

export const FOLLOW_UP_LABEL = {
	not_contacted: "Not contacted",
	contacted: "Contacted",
	follow_up_required: "Follow-up required",
	meeting_confirmed: "Meeting confirmed",
	not_interested: "Not interested",
	unable_to_reach: "Unable to reach",
	completed: "Completed",
};
const FOLLOW_UP_TONE = { not_contacted: "", contacted: "info", follow_up_required: "warning", meeting_confirmed: "success", not_interested: "", unable_to_reach: "danger", completed: "success" };
export const OUTCOME_LABEL = { spoke_to_customer: "Spoke to customer", no_answer: "No answer", busy: "Busy", voicemail_left: "Voicemail left", wrong_number: "Wrong number", call_back_requested: "Call back requested", other: "Other" };
export const INTEREST_LABEL = { high: "High", medium: "Medium", low: "Low", none: "None" };
export const PURPOSE_LABEL = { product_demo: "Product demo", course_inquiry: "Course enquiry", partnership: "Partnership", technical_support: "Technical support", other: "Other" };
export const MEETING_STATUS_LABEL = { pending: "Pending", approved: "Approved", rejected: "Rejected", reschedule_requested: "Reschedule requested", cancelled: "Cancelled" };
export const EVENT_LABEL = { take: "Claimed", transfer: "Transferred", admin_assign: "Assigned by admin", admin_clear: "Ownership cleared by admin", status_change: "Follow-up status changed", completed: "Follow-up completed" };
export const FILTER_LABEL = { all: "All meetings", unclaimed: "Unclaimed", mine: "My follow-ups", due_today: "Due today", overdue: "Overdue", completed: "Completed" };

export const FollowupBadge = ({ status }) => <span className={`ss-badge ${FOLLOW_UP_TONE[status] ? `ss-badge--${FOLLOW_UP_TONE[status]}` : ""}`}>{FOLLOW_UP_LABEL[status] || status}</span>;
// The ORIGINAL meeting status (owned by the admin Meeting Requests workflow), shown separately and never editable here.
export const MeetingBadge = ({ status }) => <span className="ss-badge" title="The meeting request's own status, managed by administrators">Meeting: {MEETING_STATUS_LABEL[status] || status}</span>;

export const Empty = ({ title, text }) => (
	<div className="ss-empty" role="status">
		<h3>{title}</h3>
		{text && <p>{text}</p>}
	</div>
);

// One line describing an ownership / status event.
export const eventText = (e) => {
	switch (e.event_type) {
		case "take":
			return `${e.actor_name} claimed this follow-up`;
		case "transfer":
			return `${e.actor_name} transferred it from ${e.from_name || "—"} to ${e.to_name || "—"}`;
		case "admin_assign":
			return `${e.actor_name} (admin) assigned it ${e.from_name ? `from ${e.from_name} ` : ""}to ${e.to_name || "—"}`;
		case "admin_clear":
			return `${e.actor_name} (admin) cleared ownership${e.from_name ? ` (was ${e.from_name})` : ""}`;
		case "completed":
			return `${e.actor_name} marked the follow-up completed`;
		default:
			return `${e.actor_name} changed the follow-up status${e.from_status ? ` from ${FOLLOW_UP_LABEL[e.from_status] || e.from_status}` : ""} to ${FOLLOW_UP_LABEL[e.to_status] || e.to_status}`;
	}
};
