import React, { useState } from "react";
import axios from "axios";
import toast from "react-hot-toast";
import { StatusBadge, STATUS_LABEL } from "@/components/BecomeATelecaller/TelecallerApplicationForm";

// Pieces shared by the Admin > Telecallers screens. Everything here is display: every read and every action goes through
// /api/admin/telecallers/*, which authorises each call on the server (admin role re-read from the database).
export { StatusBadge, STATUS_LABEL };

export const msg = (e) => (e && e.response && e.response.data && e.response.data.message) || "Something went wrong.";
export const fmt = (d) => (d ? new Date(d).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "–");
export const fmtDay = (d) => (d ? new Date(d).toLocaleDateString(undefined, { dateStyle: "medium" }) : "–");
const kb = (n) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const title = (s) => (s ? String(s).replace(/_/g, " ") : "");

export const QUALIFICATION = { high_school: "High school", diploma: "Diploma / certificate", bachelor: "Bachelor's degree", master: "Master's degree", doctorate: "Doctorate", other: "Other" };
export const EMPLOYMENT = { full_time: "Full-time", part_time: "Part-time" };

// A blob download through axios so the login token goes with the request (an <a href> could not send it).
export async function fetchResume(r) {
	try {
		const res = await axios.get(`/api/admin/telecallers/resumes/${r.id}`, { responseType: "blob" });
		return res.data;
	} catch (e) {
		// an error body arrives as a Blob too: read the server's message out of it
		let m = "The resume could not be downloaded.";
		try {
			const t = await e.response.data.text();
			m = JSON.parse(t).message || m;
		} catch (x) {
			/* keep the generic message */
		}
		throw new Error(m);
	}
}
export async function downloadResume(r, { view = false } = {}) {
	try {
		const blob = await fetchResume(r);
		const url = URL.createObjectURL(blob);
		if (view) {
			window.open(url, "_blank", "noopener");
		} else {
			const a = document.createElement("a");
			a.href = url;
			a.download = r.filename;
			document.body.appendChild(a);
			a.click();
			a.remove();
		}
		setTimeout(() => URL.revokeObjectURL(url), 60000);
	} catch (e) {
		toast.error(e.message);
	}
}

const Row = ({ k, children }) => (children ? <div className="ia-row"><dt>{k}</dt><dd>{children}</dd></div> : null);

// The applicant's details (as they reported them) for one application.
export const Facts = ({ a }) => (
	<dl className="ia-summary ia-summary--stack">
		<Row k="Phone">{a.phone}</Row>
		<Row k="Location">{[a.city, a.state].filter(Boolean).join(", ")}</Row>
		<Row k="Highest qualification">{QUALIFICATION[a.qualification]}</Row>
		<Row k="Telecalling experience">{a.has_telecalling_experience === true ? `${a.experience_years == null ? 0 : a.experience_years} year(s)` : a.has_telecalling_experience === false ? "No telecalling experience (new)" : ""}</Row>
		<Row k="Previous company">{a.previous_company}</Row>
		<Row k="Languages">{a.languages}</Row>
		<Row k="Employment preference">{EMPLOYMENT[a.employment_preference]}</Row>
		<Row k="Additional information"><span className="ia-pre">{a.additional_info}</span></Row>
		<Row k="Consent">18+ confirmed: {a.confirmed_adult ? "yes" : "no"} · Review consent: {a.consented_privacy ? "yes" : "no"}{a.consented_at ? ` (${fmtDay(a.consented_at)})` : ""}</Row>
	</dl>
);

// Every resume version, grouped by attempt, newest attempt last. Download (and View for PDFs) go through the admin-only API.
export const ResumeVersions = ({ attempts }) => {
	const [busy, setBusy] = useState("");
	const total = (attempts || []).reduce((n, a) => n + a.resumes.length, 0);
	if (!total) return <p className="ss-muted">No resume has been uploaded.</p>;
	const run = async (r, view) => {
		setBusy(r.id);
		await downloadResume(r, { view });
		setBusy("");
	};
	return (
		<div className="ia-resumes">
			{attempts.filter((a) => a.resumes.length).map((a) => (
				<div key={a.attempt}>
					<p className="ss-muted" style={{ margin: "8px 0 4px" }}><strong>Attempt {a.attempt}</strong>{a.resumes.some((r) => r.current) ? " (current)" : ""}</p>
					<ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
						{a.resumes.map((r) => (
							<li key={r.id} style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 6 }}>
								<i className="ri-file-text-line" aria-hidden="true"></i>
								<strong>{r.filename}</strong>
								<span className="ss-muted">{kb(r.size_bytes)} · {fmt(r.uploaded_at)}</span>
								<span style={{ display: "inline-flex", gap: 6, whiteSpace: "nowrap" }}>
									<button type="button" className="ss-btn ss-btn--ghost ss-btn--sm" disabled={busy === r.id} onClick={() => run(r, false)} aria-label={`Download ${r.filename}`}>{busy === r.id ? "…" : "Download"}</button>
									{r.mime_type === "application/pdf" && <button type="button" className="ss-btn ss-btn--ghost ss-btn--sm" disabled={busy === r.id} onClick={() => run(r, true)} aria-label={`View ${r.filename}`}>View</button>}
								</span>
							</li>
						))}
					</ul>
				</div>
			))}
		</div>
	);
};

const EMAIL_LABEL = { none: "", sent: "e-mail sent", skipped: "e-mail not sent (not configured)", failed: "e-mail failed" };

const same = (x, y) => JSON.stringify(x == null ? null : x) === JSON.stringify(y == null ? null : y);
const yesNo = (v) => (v === true ? "yes" : v === false ? "no" : "");

// "Answers as submitted": the complete form exactly as the applicant submitted it at that moment, read from the stored
// snapshot (never from the live application row, which later edits and new attempts change). `prev` is the previous
// submission's snapshot in the same attempt, used only to mark which answers changed. Display only: nothing can be edited.
export const SubmittedAnswers = ({ snap, prev, open }) => {
	const f = snap.fields;
	const was = prev ? prev.fields : null;
	const changed = (...keys) => !!was && keys.some((k) => !same(f[k], was[k]));
	const Item = ({ k, keys, children }) =>
		children ? (
			<div className="ia-row">
				<dt>{k}{changed(...keys) && <span className="ss-badge ss-badge--warning" style={{ marginLeft: 6 }}>changed</span>}</dt>
				<dd>{children}</dd>
			</div>
		) : null;
	const changedKeys = was ? Object.keys(f).filter((k) => !same(f[k], was[k])) : [];
	return (
		<details className="ia-answers" open={open} style={{ margin: "6px 0 10px" }}>
			<summary><strong>Answers as submitted</strong>{was && <span className="ss-muted"> · {changedKeys.length ? `${changedKeys.length} answer(s) changed since the previous submission` : "no answers changed since the previous submission"}</span>}</summary>
			<dl className="ia-summary ia-summary--stack">
				<Item k="Name" keys={["full_name"]}>{f.full_name}</Item>
				<Item k="Phone" keys={["phone"]}>{f.phone}</Item>
				<Item k="Location" keys={["city", "state"]}>{[f.city, f.state].filter(Boolean).join(", ")}</Item>
				<Item k="Highest qualification" keys={["qualification"]}>{QUALIFICATION[f.qualification]}</Item>
				<Item k="Telecalling experience" keys={["has_telecalling_experience", "experience_years"]}>{f.has_telecalling_experience === true ? `${f.experience_years == null ? 0 : f.experience_years} year(s)` : f.has_telecalling_experience === false ? "No telecalling experience (new)" : ""}</Item>
				<Item k="Previous company" keys={["previous_company"]}>{f.previous_company}</Item>
				<Item k="Languages" keys={["languages"]}>{f.languages}</Item>
				<Item k="Employment preference" keys={["employment_preference"]}>{EMPLOYMENT[f.employment_preference]}</Item>
				<Item k="Additional information" keys={["additional_info"]}><span className="ia-pre">{f.additional_info}</span></Item>
				<Item k="Confirmations" keys={["confirmed_adult", "consented_privacy"]}>18+ confirmed: {yesNo(f.confirmed_adult)} · Review consent: {yesNo(f.consented_privacy)}</Item>
				<Item k="Resumes attached" keys={[]}>{snap.resumes.length ? snap.resumes.map((r) => r.filename).join(", ") : ""}</Item>
			</dl>
		</details>
	);
};

// The decision audit trail, one block per attempt: every status change with who did it, the message to the applicant, the
// private note and what happened to the e-mail; each submission also shows the answers as submitted. Nothing here can be edited.
export const AttemptHistory = ({ attempts }) => (
	<div>
		{(attempts || []).slice().reverse().map((a) => {
			const lastSnap = a.events.reduce((n, h, i) => (h.snapshot ? i : n), -1);
			let prevSnap = null;
			return (
				<section key={a.attempt} aria-label={`Attempt ${a.attempt}`}>
					<h4 className="ss-subhead" style={{ fontSize: "1em", margin: "12px 0 4px" }}>Attempt {a.attempt}</h4>
					{a.events.length === 0 ? (
						<p className="ss-muted">No events.</p>
					) : (
						<ol className="ia-timeline">
							{a.events.map((h, i) => {
								const before = prevSnap;
								if (h.snapshot) prevSnap = h.snapshot;
								return (
									<li key={h.id}>
										<strong>{STATUS_LABEL[h.to] || title(h.to)}</strong>{" "}
										<span className="ss-muted">{fmt(h.at)} · {h.actor === "applicant" ? "applicant" : h.actor_name || h.actor}{EMAIL_LABEL[h.email_status] ? ` · ${EMAIL_LABEL[h.email_status]}` : ""}</span>
										{h.feedback && <p>To applicant: {h.feedback}</p>}
										{h.internal_note && <p className="ss-muted">Private: {h.internal_note}</p>}
										{h.snapshot ? (
											<SubmittedAnswers snap={h.snapshot} prev={before} open={i === lastSnap} />
										) : h.submission ? (
											<p className="ss-muted">Answers as submitted were not recorded for this submission.</p>
										) : null}
									</li>
								);
							})}
						</ol>
					)}
				</section>
			);
		})}
	</div>
);

// Loading / error / empty states used by every list.
export const ListState = ({ error, loading, empty, emptyTitle, emptyText, onRetry, children }) => {
	if (error) return <div className="ss-alert ss-alert--danger" role="alert">{error} {onRetry && <button type="button" className="ss-link-btn" onClick={onRetry}>Try again</button>}</div>;
	if (loading) return <p className="ss-muted" role="status">Loading…</p>;
	if (empty) return (
		<div className="ss-empty" role="status">
			<span className="ss-icon-tile ss-icon-tile--lg" aria-hidden="true"><i className="ri-inbox-line"></i></span>
			<h3>{emptyTitle}</h3>
			{emptyText && <p>{emptyText}</p>}
		</div>
	);
	return children;
};
