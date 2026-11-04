// Meeting-request e-mails. Pure builders: they return { to, subject, html } and
// never send anything. Every visitor-supplied value is HTML-escaped.
import { formatInZone } from "./time.js";

const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const PURPOSE = { product_demo: "Product demo", course_inquiry: "Course inquiry", partnership: "Partnership", technical_support: "Technical support", other: "Other" };
export const purposeLabel = (p) => PURPOSE[p] || p;

const shell = (title, body) => `<!DOCTYPE html><html><body style="margin:0;background:#f4f6fb;font-family:Arial,Helvetica,sans-serif;color:#1f2937">
<div style="max-width:560px;margin:0 auto;padding:24px">
<div style="background:#2f55d4;color:#fff;padding:16px 24px;border-radius:12px 12px 0 0;font-size:18px;font-weight:bold">SharpStudy</div>
<div style="background:#fff;padding:24px;border-radius:0 0 12px 12px;line-height:1.55">
<h2 style="margin:0 0 12px;font-size:20px">${esc(title)}</h2>${body}
</div></div></body></html>`;
const row = (k, v) => `<tr><td style="padding:4px 12px 4px 0;color:#667085;vertical-align:top">${esc(k)}</td><td style="padding:4px 0"><strong>${v}</strong></td></tr>`;
const button = (href, label) => `<p style="margin:20px 0"><a href="${esc(href)}" style="background:#2f55d4;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;display:inline-block">${esc(label)}</a></p>`;

// ctx: { baseUrl, adminTo, statusUrl }
export function adminNewRequestEmail(r, ctx) {
	const link = `${ctx.baseUrl}/admin/meetings/?open=${encodeURIComponent(r.id)}`;
	return {
		to: ctx.adminTo,
		subject: `New meeting request ${r.reference} from ${String(r.name).replace(/[\r\n]+/g, " ").slice(0, 60)}`,
		html: shell(
			"New meeting request",
			`<table>${row("Reference", esc(r.reference))}${row("Name", esc(r.name))}${row("Purpose", esc(purposeLabel(r.purpose)))}${row("Requested", esc(formatInZone(r.requested_at, r.time_zone)))}${row("Email", esc(r.email))}</table>
<p>This request is <strong>pending</strong>. It is not confirmed until you approve it.</p>${button(link, "Review request")}`
		),
	};
}

export function visitorReceivedEmail(r, ctx) {
	return {
		to: r.email,
		subject: `We received your meeting request (${r.reference})`,
		html: shell(
			"We received your request",
			`<p>Hi ${esc(r.name)}, thanks for asking to meet with SharpStudy.</p>
<table>${row("Reference", esc(r.reference))}${row("Purpose", esc(purposeLabel(r.purpose)))}${row("Requested time", esc(formatInZone(r.requested_at, r.time_zone)))}</table>
<p><strong>Your meeting is not confirmed yet.</strong> A member of our team will review it and email you again.</p>
${ctx.statusUrl ? button(ctx.statusUrl, "View or cancel your request") : ""}`
		),
	};
}

export function visitorDecisionEmail(r, ctx) {
	const tz = r.confirmed_time_zone || r.time_zone;
	if (r.status === "approved") {
		return {
			to: r.email,
			subject: `Your SharpStudy meeting is confirmed (${r.reference})`,
			html: shell(
				"Your meeting is confirmed",
				`<p>Hi ${esc(r.name)}, your meeting has been approved.</p>
<table>${row("When", esc(formatInZone(r.confirmed_start, tz)))}${row("Duration", `${esc(r.duration_minutes)} minutes`)}${row("Meeting link", r.meeting_url ? `<a href="${esc(r.meeting_url)}">${esc(r.meeting_url)}</a>` : "To follow")}${row("Reference", esc(r.reference))}</table>
${r.meeting_url ? button(r.meeting_url, "Join the meeting") : ""}${ctx.statusUrl ? `<p>Need to cancel? <a href="${esc(ctx.statusUrl)}">Manage your request</a>.</p>` : ""}`
			),
		};
	}
	if (r.status === "rejected") {
		return {
			to: r.email,
			subject: `About your meeting request (${r.reference})`,
			html: shell(
				"Update on your meeting request",
				`<p>Hi ${esc(r.name)}, thank you for your interest in SharpStudy.</p>
<p>Unfortunately we are not able to schedule this meeting. We are sorry for the inconvenience and appreciate you reaching out. You are welcome to submit a new request or contact us any time.</p>
<p style="color:#667085">Reference: ${esc(r.reference)}</p>${ctx.statusUrl ? `<p><a href="${esc(ctx.statusUrl)}">View this request</a></p>` : ""}`
			),
		};
	}
	if (r.status === "reschedule_requested") {
		return {
			to: r.email,
			subject: `A new time is proposed for your meeting (${r.reference})`,
			html: shell(
				"We would like to propose a different time",
				`<p>Hi ${esc(r.name)}, we cannot meet at the time you asked for, but we can offer this instead:</p>
<table>${row("Proposed time", esc(formatInZone(r.proposed_start, tz)))}${row("Duration", `${esc(r.duration_minutes)} minutes`)}${row("Reference", esc(r.reference))}</table>
<p>Use the link below to <strong>accept</strong> this time or cancel the request. If it does not suit you, cancel it there and send a new request with a time that works for you.</p>
${ctx.statusUrl ? button(ctx.statusUrl, "Respond to this proposal") : ""}`
			),
		};
	}
	if (r.status === "cancelled") {
		return {
			to: r.email,
			subject: `Your meeting request was cancelled (${r.reference})`,
			html: shell("Meeting request cancelled", `<p>Hi ${esc(r.name)}, your meeting request <strong>${esc(r.reference)}</strong> has been cancelled. You can submit a new request at any time.</p>${ctx.statusUrl ? `<p><a href="${esc(ctx.statusUrl)}">View this request</a></p>` : ""}`),
		};
	}
	return null;
}
