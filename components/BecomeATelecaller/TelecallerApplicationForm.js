import React, { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import axios from "axios";
import toast from "react-hot-toast";
import { Field } from "@/components/ui/Form";
import { Button } from "@/components/ui";
import { validateForSubmit, QUALIFICATIONS, EMPLOYMENT, RESUME } from "@/lib/telecallers/rules";

// The applicant side of "Become a Telecaller": the form, the resume versions, and the status page (the same page shows
// Pending Approval, More information requested, Approved or Not approved). Everything is read from and written to the
// signed-in user's OWN application; submitting grants nothing, an administrator decides.
const API = "/api/telecallers/apply";
const RESUME_API = "/api/telecallers/resume";

const LABEL = {
	qualification: { high_school: "High school", diploma: "Diploma / certificate", bachelor: "Bachelor's degree", master: "Master's degree", doctorate: "Doctorate", other: "Other" },
	employment: { full_time: "Full-time", part_time: "Part-time" },
};
export const STATUS_LABEL = { draft: "Draft", pending: "Pending Approval", more_info_requested: "More information requested", approved: "Approved", rejected: "Not approved" };
const STATUS_TONE = { draft: "", pending: "warning", more_info_requested: "warning", approved: "success", rejected: "danger" };
export const StatusBadge = ({ status }) => <span className={`ss-badge ss-badge--${STATUS_TONE[status] || ""}`}>{STATUS_LABEL[status] || status}</span>;

const msg = (e) => (e.response && e.response.data && e.response.data.message) || "Something went wrong. Please try again.";
const fmt = (d) => (d ? new Date(d).toLocaleDateString(undefined, { dateStyle: "medium" }) : "");
const kb = (n) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

const FIELDS = ["full_name", "phone", "city", "state", "qualification", "has_telecalling_experience", "experience_years", "previous_company", "languages", "employment_preference", "additional_info", "confirmed_adult", "consented_privacy"];
const toForm = (app, prefill) => {
	const f = {};
	for (const k of FIELDS) f[k] = app && app[k] != null ? app[k] : ["confirmed_adult", "consented_privacy"].includes(k) ? false : "";
	if (!f.full_name) f.full_name = prefill.full_name;
	if (!f.phone) f.phone = prefill.phone || "";
	return f;
};

const readBase64 = (file) =>
	new Promise((resolve, reject) => {
		const r = new FileReader();
		r.onload = () => resolve(String(r.result).split(",")[1] || "");
		r.onerror = () => reject(new Error("The file could not be read."));
		r.readAsDataURL(file);
	});

const Group = ({ title, hint, children }) => (
	<fieldset className="ia-section">
		<legend>{title}</legend>
		{hint && <p className="ia-hint">{hint}</p>}
		<div className="ia-grid">{children}</div>
	</fieldset>
);

const Choices = ({ legend, name, options, value, onChange, error }) => (
	<div className="form-group ia-wide" role="group" aria-labelledby={`${name}-l`}>
		<span className="form-label" id={`${name}-l`}>{legend}</span>
		<div className="ia-choices">
			{options.map(([v, label]) => (
				<label key={String(v)} className="ia-choice">
					<input type="radio" name={name} checked={value === v} onChange={() => onChange(v)} />
					<span>{label}</span>
				</label>
			))}
		</div>
		{error && <div className="ss-field-error" role="alert">{error}</div>}
	</div>
);

const ResumeList = ({ resumes }) =>
	resumes && resumes.length ? (
		<ul className="ia-resumes" aria-label="Your resume versions" style={{ listStyle: "none", padding: 0, margin: "8px 0 0" }}>
			{resumes.map((r) => (
				<li key={r.id} style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 4 }}>
					<i className="ri-file-text-line" aria-hidden="true"></i>
					<strong>{r.filename}</strong>
					<span className="ss-muted">{kb(r.size_bytes)} · uploaded {fmt(r.uploaded_at)}</span>
					<span className={`ss-badge ss-badge--${r.current ? "primary" : ""}`}>{r.current ? "Current attempt" : `Attempt ${r.attempt}`}</span>
				</li>
			))}
		</ul>
	) : null;

const Timeline = ({ history }) =>
	history && history.length ? (
		<ol className="ia-timeline" aria-label="Application history">
			{history.map((h, i) => (
				<li key={i}>
					<strong>{STATUS_LABEL[h.to] || h.to}</strong> <span className="ss-muted">attempt {h.attempt} · {fmt(h.at)}</span>
					{h.feedback && <p>{h.feedback}</p>}
				</li>
			))}
		</ol>
	) : null;

const Summary = ({ a }) => (
	<dl className="ia-summary">
		{[["Name", a.full_name], ["Location", [a.city, a.state].filter(Boolean).join(", ")], ["Qualification", LABEL.qualification[a.qualification]], ["Experience", a.has_telecalling_experience ? `${a.experience_years} year(s)` : a.has_telecalling_experience === false ? "No telecalling experience yet" : ""], ["Preference", LABEL.employment[a.employment_preference]], ["Attempt", String(a.attempt)], ["Submitted", fmt(a.submitted_at)]].map(([k, v]) => (v ? <div key={k}><dt>{k}</dt><dd>{v}</dd></div> : null))}
	</dl>
);

const TelecallerApplicationForm = () => {
	const [data, setData] = useState(null);
	const [error, setError] = useState("");
	const [form, setForm] = useState(null);
	const [errors, setErrors] = useState({});
	const [busy, setBusy] = useState("");
	const [submitted, setSubmitted] = useState(false);
	const busyRef = useRef(false);
	const fileRef = useRef(null);

	const load = useCallback(async () => {
		try {
			const { data: d } = await axios.get(API);
			setData(d);
			setForm((f) => (f && d.application && d.application.can_edit ? f : toForm(d.application, d.prefill)));
			setError("");
		} catch (e) {
			setError(msg(e));
		}
	}, []);
	useEffect(() => {
		load();
	}, [load]);

	if (error && !data) {
		return (
			<div className="ss-alert ss-alert--danger" role="alert">
				{error} <button type="button" className="ss-link-btn" onClick={load}>Try again</button>
			</div>
		);
	}
	if (!data || !form) return <p className="ss-muted" role="status">Loading your application…</p>;

	const app = data.application;
	const set = (k) => (v) => setForm((f) => ({ ...f, [k]: v }));
	const input = (k) => ({ value: form[k] == null ? "" : form[k], onChange: (e) => set(k)(e.target.value) });
	const act = async (kind, fn) => {
		if (busyRef.current) return;
		busyRef.current = true;
		setBusy(kind);
		try {
			await fn();
		} catch (e) {
			const f = e.response && e.response.data && e.response.data.fields;
			if (f) setErrors(f);
			toast.error(msg(e));
		} finally {
			busyRef.current = false;
			setBusy("");
		}
	};
	const save = () =>
		act("save", async () => {
			const { data: d } = await axios.put(API, form);
			setErrors({});
			toast.success("Draft saved.");
			setData((x) => ({ ...x, application: d.application }));
		});
	const submit = (e) => {
		e.preventDefault();
		const local = validateForSubmit(form, { resumeCount: (app ? app.resumes : []).filter((r) => r.current).length });
		setErrors(local);
		if (Object.keys(local).length) {
			toast.error("Please complete the highlighted fields.");
			const first = document.querySelector("[aria-invalid='true'], .ss-field-error");
			if (first && first.scrollIntoView) first.scrollIntoView({ block: "center" });
			return;
		}
		act("submit", async () => {
			await axios.post(API, form);
			setSubmitted(true);
			setForm(null);
			toast.success("Application submitted. We will email you with updates.");
			await load();
			if (typeof window !== "undefined" && window.scrollTo) window.scrollTo({ top: 0, behavior: "smooth" });
		});
	};
	const upload = (ev) => {
		const file = ev.target.files && ev.target.files[0];
		if (fileRef.current) fileRef.current.value = "";
		if (!file) return;
		const ext = (file.name.match(/\.([A-Za-z0-9]+)$/) || [])[1];
		if (!ext || !RESUME.extensions.includes(ext.toLowerCase())) return setErrors((x) => ({ ...x, resume: "The resume must be a PDF, DOC or DOCX file." }));
		if (file.size > RESUME.maxBytes) return setErrors((x) => ({ ...x, resume: "The resume is larger than 2 MB." }));
		act("upload", async () => {
			const { data: d } = await axios.post(RESUME_API, { filename: file.name, data: await readBase64(file) });
			setErrors((x) => ({ ...x, resume: undefined }));
			setData((x) => ({ ...x, application: d.application }));
			toast.success(d.duplicate ? "That file is already attached." : "Resume uploaded.");
		});
	};

	// ---- accounts that cannot apply
	if (!data.eligible) return <div className="ss-alert" role="status">{data.ineligible_reason || "This account cannot apply as a telecaller."}</div>;

	// ---- states without the form (pending, approved, rejected)
	if (app && !app.can_edit && app.status !== "draft") {
		const rejected = app.status === "rejected";
		const active = app.status === "approved" && data.access && data.access.status === "active";
		const deactivated = app.status === "approved" && data.access && data.access.status === "inactive";
		return (
			<div className="ia-card">
				{submitted && app.status === "pending" && (
					<div className="ss-alert ss-alert--success" role="status">
						<strong>Application submitted.</strong> It is now pending approval. You can come back to this page at any time to check its status.
					</div>
				)}
				<div className="ia-head"><h2>Telecaller application</h2><StatusBadge status={app.status} /></div>
				{app.status === "pending" && <p>Thanks! Your application was received and is <strong>pending approval</strong>. Applying does not give any telecaller access: an administrator reviews every application, and we will notify you of the decision.</p>}
				{active && <p>Your application was <strong>approved</strong> and your telecaller access is active. The telecaller dashboard is not open yet; we will let you know as soon as it is.</p>}
				{deactivated && <p>Your application was approved, but your telecaller access is currently <strong>deactivated</strong>. Please contact SharpStudy support if you have questions.</p>}
				{app.status === "approved" && !data.access && <p>Your application was approved. Your telecaller access is being set up.</p>}
				{rejected && <p>Your application was not approved. Your account keeps its normal access.</p>}
				{app.feedback && <blockquote className="ia-feedback"><strong>Message from the review team</strong><br />{app.feedback}</blockquote>}
				<Summary a={app} />
				<h3 className="ss-subhead">Resumes</h3>
				<ResumeList resumes={app.resumes} />
				<h3 className="ss-subhead">History</h3>
				<Timeline history={app.history} />
				{rejected && (
					<div className="ia-actions">
						{app.can_reapply ? (
							<Button disabled={!!busy} onClick={() => act("reapply", async () => { await axios.post(API, { action: "reapply" }); setForm(null); setSubmitted(false); await load(); })}>Start a new application</Button>
						) : (
							<p className="ss-muted">You can apply again after {fmt(app.reapply_after)}. Your earlier application and resumes are kept.</p>
						)}
					</div>
				)}
			</div>
		);
	}

	// ---- the form (draft or more information requested)
	const e = errors;
	const noEmail = !data.email_confirmed;
	const resendConfirmation = async () => {
		try {
			const r = await axios.post("/api/users/send-confirmation-email", { email: data.prefill.email, next: "/become-a-telecaller/" });
			toast.success(r.data.message || "Please check your email and confirm.");
		} catch (err) {
			toast.error(msg(err));
		}
	};
	return (
		<form className="ia-form" onSubmit={submit} noValidate aria-describedby="tc-intro">
			<div className="ia-head"><h2>Telecaller application</h2>{app && <StatusBadge status={app.status} />}</div>
			<p id="tc-intro" className="ss-muted">Tell us about yourself and upload your resume. You can save a draft and return later. Applying does not give any access until an administrator approves your application.</p>
			{noEmail && <div className="ss-alert ss-alert--warning" role="alert">Confirm your email address before submitting. <button type="button" className="ss-link-btn" onClick={resendConfirmation} disabled={!!busy}>Resend confirmation email</button></div>}
			{app && app.status === "more_info_requested" && <blockquote className="ia-feedback"><strong>The review team asked for more information</strong><br />{app.feedback}</blockquote>}
			{app && app.attempt > 1 && <p className="ss-muted">This is attempt {app.attempt}. Your earlier application and resumes are kept.</p>}

			<Group title="1. Personal information">
				<Field label="Full name" required error={e.full_name} {...input("full_name")} autoComplete="name" />
				<Field label="Email address" value={data.prefill.email} readOnly hint="From your account." />
				<Field label="Phone number" required error={e.phone} {...input("phone")} autoComplete="tel" inputMode="tel" />
				<Field label="City" required error={e.city} {...input("city")} autoComplete="address-level2" />
				<Field label="State" required error={e.state} {...input("state")} autoComplete="address-level1" />
				<div className="form-group">
					<span className="form-label">Profile photo (optional)</span>
					<div className="ia-photo">
						{/* eslint-disable-next-line @next/next/no-img-element */}
						{data.prefill.profile_photo ? <img className="ss-avatar ss-avatar--lg" src={data.prefill.profile_photo} alt="Your profile photo" /> : <span className="ss-muted">No photo yet.</span>}
						<Link href="/profile/photo/"><a>Change photo</a></Link>
					</div>
				</div>
			</Group>

			<Group title="2. Background">
				<Field label="Highest qualification" error={e.qualification}>
					<select className="form-control" value={form.qualification} onChange={(ev) => set("qualification")(ev.target.value)} required>
						<option value="">Choose…</option>
						{QUALIFICATIONS.map((v) => <option key={v} value={v}>{LABEL.qualification[v]}</option>)}
					</select>
				</Field>
				<Field label="Languages known" required error={e.languages} {...input("languages")} hint="For example: English, Hindi, Marathi." />
				<Choices name="tcexp" legend="Telecalling experience" value={form.has_telecalling_experience === true ? "yes" : form.has_telecalling_experience === false ? "no" : ""} error={e.has_telecalling_experience} onChange={(v) => set("has_telecalling_experience")(v === "yes")} options={[["yes", "I have telecalling experience"], ["no", "I have no telecalling experience yet"]]} />
				{form.has_telecalling_experience === true && <Field label="Years of telecalling experience" type="number" min="0" max="60" error={e.experience_years} {...input("experience_years")} />}
				<Field label="Previous company (optional)" {...input("previous_company")} />
				<Choices name="tcpref" legend="Employment preference" value={form.employment_preference} error={e.employment_preference} onChange={set("employment_preference")} options={EMPLOYMENT.map((v) => [v, LABEL.employment[v]])} />
			</Group>

			<Group title="3. Resume" hint="PDF, DOC or DOCX, up to 2 MB. It is stored privately and only SharpStudy administrators can open it. Uploading another file adds a new version; earlier versions are kept.">
				<div className="form-group ia-wide">
					<label className="form-label" htmlFor="tc-resume">Upload your resume</label>
					<input id="tc-resume" ref={fileRef} type="file" className="form-control" accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document" onChange={upload} disabled={!!busy} aria-invalid={e.resume ? true : undefined} />
					{busy === "upload" && <p className="ss-muted" role="status">Uploading…</p>}
					{e.resume && <div className="ss-field-error" role="alert">{e.resume}</div>}
					<ResumeList resumes={app ? app.resumes : []} />
				</div>
			</Group>

			<Group title="4. Anything else?">
				<Field label="Additional information (optional)" className="ia-wide"><textarea className="form-control" rows={4} {...input("additional_info")} /></Field>
				<div className="ia-wide">
					<label className="ia-choice"><input type="checkbox" checked={form.confirmed_adult} onChange={(ev) => set("confirmed_adult")(ev.target.checked)} /><span>I confirm that I am at least 18 years old.</span></label>
					{e.confirmed_adult && <div className="ss-field-error" role="alert">{e.confirmed_adult}</div>}
					<label className="ia-choice"><input type="checkbox" checked={form.consented_privacy} onChange={(ev) => set("consented_privacy")(ev.target.checked)} /><span>I consent to SharpStudy reviewing this application and my resume under the <Link href="/privacy-policy/"><a>privacy policy</a></Link>.</span></label>
					{e.consented_privacy && <div className="ss-field-error" role="alert">{e.consented_privacy}</div>}
				</div>
			</Group>

			<div className="ia-actions">
				<Button variant="ghost" type="button" disabled={!!busy} onClick={save}>{busy === "save" ? "Saving…" : "Save draft"}</Button>
				<Button type="submit" disabled={!!busy || noEmail}>{busy === "submit" ? "Submitting…" : app && app.status === "more_info_requested" ? "Resubmit application" : "Submit application"}</Button>
			</div>
		</form>
	);
};

export default TelecallerApplicationForm;
