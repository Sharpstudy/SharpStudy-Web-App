import React, { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import axios from "axios";
import toast from "react-hot-toast";
import { Field } from "@/components/ui/Form";
import { Button } from "@/components/ui";
import { validateForSubmit, EDUCATION_LEVELS, STUDENT_LEVELS, TEACHING_MODES, SAMPLE_KINDS } from "@/lib/instructor-applications/rules";

const API = "/api/instructor/new";
const LABEL = {
	education: { high_school: "High school", diploma: "Diploma / certificate", bachelor: "Bachelor's degree", master: "Master's degree", doctorate: "Doctorate", other: "Other" },
	levels: { elementary: "Elementary", middle_school: "Middle school", high_school: "High school", college: "College / university", adult: "Adult learners", professional: "Professionals" },
	modes: { online: "Online", offline: "In person" },
	kinds: { video: "A video of me teaching (link)", document: "A sample teaching document (link)", lesson_plan: "A written lesson demonstration (no link needed)" },
};
export const STATUS_LABEL = { draft: "Draft", pending: "Pending", under_review: "Under review", more_info_requested: "More information requested", approved: "Approved", rejected: "Not approved", revoked: "Access removed" };
const STATUS_TONE = { draft: "", pending: "warning", under_review: "primary", more_info_requested: "warning", approved: "success", rejected: "danger", revoked: "danger" };
export const StatusBadge = ({ status }) => <span className={`ss-badge ss-badge--${STATUS_TONE[status] || ""}`}>{STATUS_LABEL[status] || status}</span>;
const msg = (e) => (e.response && e.response.data && e.response.data.message) || "Something went wrong. Please try again.";
const fmt = (d) => (d ? new Date(d).toLocaleDateString(undefined, { dateStyle: "medium" }) : "");

const FIELDS = ["full_name", "phone", "country", "location", "education_level", "degree", "institution", "graduation_year", "certifications", "profession", "has_teaching_experience", "teaching_years", "teaching_modes", "student_levels", "prior_experience", "subjects", "topics", "languages", "expertise_notes", "sample_kind", "sample_url", "sample_title", "sample_outline", "methodology", "material_url", "motivation", "agreed_policies", "consented_privacy"];
const toForm = (app, prefill) => {
	const f = {};
	for (const k of FIELDS) f[k] = app && app[k] != null ? app[k] : ["teaching_modes", "student_levels", "subjects"].includes(k) ? [] : ["agreed_policies", "consented_privacy"].includes(k) ? false : "";
	if (!f.full_name) f.full_name = prefill.full_name;
	if (!f.phone) f.phone = prefill.phone || "";
	return f;
};

const Group = ({ title, hint, children }) => (
	<fieldset className="ia-section">
		<legend>{title}</legend>
		{hint && <p className="ia-hint">{hint}</p>}
		<div className="ia-grid">{children}</div>
	</fieldset>
);

const Choices = ({ legend, name, options, value, onChange, type = "checkbox", error }) => (
	<div className="form-group ia-wide" role="group" aria-labelledby={`${name}-l`}>
		<span className="form-label" id={`${name}-l`}>{legend}</span>
		<div className="ia-choices">
			{options.map(([v, label]) => (
				<label key={v} className="ia-choice">
					<input type={type} name={name} checked={type === "radio" ? value === v : value.includes(v)} onChange={(e) => onChange(type === "radio" ? v : e.target.checked ? [...value, v] : value.filter((x) => x !== v))} />
					<span>{label}</span>
				</label>
			))}
		</div>
		{error && <div className="ss-field-error" role="alert">{error}</div>}
	</div>
);

const Timeline = ({ history }) =>
	history && history.length ? (
		<ol className="ia-timeline" aria-label="Application history">
			{history.map((h, i) => (
				<li key={i}>
					<strong>{STATUS_LABEL[h.to] || h.to}</strong> <span className="ss-muted">{fmt(h.at)}</span>
					{h.feedback && <p>{h.feedback}</p>}
				</li>
			))}
		</ol>
	) : null;

const Summary = ({ a }) => (
	<dl className="ia-summary">
		{[["Name", a.full_name], ["Subjects", (a.subjects || []).map((s) => s.name).join(", ")], ["Teaching experience", a.has_teaching_experience ? `${a.teaching_years} year(s)` : "New to teaching"], ["Teaching sample", a.sample_title], ["Submitted", fmt(a.submitted_at)]].map(([k, v]) => v ? <div key={k}><dt>{k}</dt><dd>{v}</dd></div> : null)}
	</dl>
);

const ApplicationForm = ({ user }) => {
	const [data, setData] = useState(null);
	const [error, setError] = useState("");
	const [form, setForm] = useState(null);
	const [errors, setErrors] = useState({});
	const [busy, setBusy] = useState("");
	const busyRef = useRef(false);

	const load = useCallback(async () => {
		try {
			const { data: d } = await axios.get(API);
			setData(d);
			setForm(toForm(d.application, d.prefill));
			setError("");
		} catch (e) {
			setError(msg(e));
		}
	}, []);
	useEffect(() => {
		load();
	}, [load]);

	if (error && !data) return <div className="ss-alert ss-alert--danger" role="alert">{error}</div>;
	if (!data) return <p className="ss-muted" role="status">Loading your application…</p>;

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
		const local = validateForSubmit(form);
		setErrors(local);
		if (Object.keys(local).length) {
			toast.error("Please complete the highlighted fields.");
			const first = document.querySelector("[aria-invalid='true'], .ss-field-error");
			if (first && first.scrollIntoView) first.scrollIntoView({ block: "center" });
			return;
		}
		act("submit", async () => {
			await axios.post(API, form);
			toast.success("Application submitted. We will email you with updates.");
			await load();
		});
	};

	// ---- states without the form
	if (data.role === "instructor" || (app && app.status === "approved"))
		return (
			<div className="ia-card">
				<h2>You are an instructor</h2>
				<p>Your account has instructor access.</p>
				<Button href="/instructor/dashboard/">Open instructor dashboard</Button>
			</div>
		);
	if (!data.eligible) return <div className="ss-alert" role="status">This account type cannot apply to teach.</div>;

	if (app && !app.can_edit && app.status !== "draft") {
		const waiting = app.status === "rejected" || app.status === "revoked";
		return (
			<div className="ia-card">
				<div className="ia-head"><h2>Instructor application</h2><StatusBadge status={app.status} /></div>
				{app.status === "pending" && <p>Thanks! Your application was received and is waiting for review. Until it is approved your account keeps its student access.</p>}
				{app.status === "under_review" && <p>A reviewer is looking at your application. Your submission is locked while this happens.</p>}
				{waiting && <p>{app.status === "revoked" ? "Your instructor access was removed." : "Your application was not approved."} Your account keeps its student access.</p>}
				{app.feedback && <blockquote className="ia-feedback"><strong>Feedback from the review team</strong><br />{app.feedback}</blockquote>}
				<Summary a={app} />
				<Timeline history={app.history} />
				{waiting && (
					<div className="ia-actions">
						{app.can_reapply ? (
							<Button disabled={!!busy} onClick={() => act("reapply", async () => { await axios.post(API, { action: "reapply" }); await load(); })}>Start a new application</Button>
						) : (
							<p className="ss-muted">You can apply again after {fmt(app.reapply_after)}.</p>
						)}
					</div>
				)}
			</div>
		);
	}

	// ---- the form (draft or more information requested)
	const e = errors;
	const lessonPlan = form.sample_kind === "lesson_plan";
	const noEmail = !data.email_confirmed;
	const resendConfirmation = async () => {
		try {
			const r = await axios.post("/api/users/send-confirmation-email", { email: data.prefill.email });
			toast.success(r.data.message || "Please check your email and confirm.");
		} catch (err) {
			toast.error(msg(err));
		}
	};
	return (
		<form className="ia-form" onSubmit={submit} noValidate aria-describedby="ia-intro">
			<div className="ia-head"><h2>Instructor application</h2>{app && <StatusBadge status={app.status} />}</div>
			<p id="ia-intro" className="ss-muted">Tell us about you and show us how you teach. Formal teaching experience is welcome but not required: new teachers are judged on subject knowledge and their teaching sample. You can save a draft and return later.</p>
			{noEmail && <div className="ss-alert ss-alert--warning" role="alert">Confirm your email address before submitting. <button type="button" className="ss-link-btn" onClick={resendConfirmation} disabled={!!busy}>Resend confirmation email</button></div>}
			{app && app.status === "more_info_requested" && <blockquote className="ia-feedback"><strong>The review team asked for more information</strong><br />{app.feedback}</blockquote>}

			<Group title="1. Personal information">
				<Field label="Full name" required error={e.full_name} {...input("full_name")} autoComplete="name" />
				<Field label="Email address" value={data.prefill.email} readOnly hint="From your account." />
				<Field label="Phone number" required error={e.phone} {...input("phone")} autoComplete="tel" inputMode="tel" />
				<Field label="Country" required error={e.country} {...input("country")} autoComplete="country-name" />
				<Field label="City / location" {...input("location")} />
				<div className="form-group">
					<span className="form-label">Profile photo</span>
					<div className="ia-photo">
						{/* eslint-disable-next-line @next/next/no-img-element */}
						{data.prefill.profile_photo ? <img className="ss-avatar ss-avatar--lg" src={data.prefill.profile_photo} alt="Your profile photo" /> : <span className="ss-muted">No photo yet.</span>}
						<Link href="/profile/photo/"><a>Change photo</a></Link>
					</div>
				</div>
			</Group>

			<Group title="2. Education and background">
				<Field label="Highest education level" error={e.education_level}>
					<select className="form-control" value={form.education_level} onChange={(ev) => set("education_level")(ev.target.value)} required>
						<option value="">Choose…</option>
						{EDUCATION_LEVELS.map((v) => <option key={v} value={v}>{LABEL.education[v]}</option>)}
					</select>
				</Field>
				<Field label="Degree or qualification" required error={e.degree} {...input("degree")} />
				<Field label="Institution" required error={e.institution} {...input("institution")} />
				<Field label="Graduation year" type="number" error={e.graduation_year} {...input("graduation_year")} />
				<Field label="Current profession (optional)" {...input("profession")} />
				<Field label="Relevant certifications (optional)" className="ia-wide"><textarea className="form-control" rows={3} {...input("certifications")} /></Field>
			</Group>

			<Group title="3. Teaching experience" hint="Do not worry if you are new to teaching.">
				<Choices type="radio" name="exp" legend="Teaching experience" value={form.has_teaching_experience === true ? "yes" : form.has_teaching_experience === false ? "no" : ""} error={e.has_teaching_experience} onChange={(v) => set("has_teaching_experience")(v === "yes")} options={[["yes", "I have taught before"], ["no", "I have no formal teaching experience yet"]]} />
				{form.has_teaching_experience === true && (
					<>
						<Field label="Years of teaching" type="number" min="0" max="60" error={e.teaching_years} {...input("teaching_years")} />
						<Choices name="modes" legend="How have you taught?" value={form.teaching_modes} onChange={set("teaching_modes")} error={e.teaching_modes} options={TEACHING_MODES.map((v) => [v, LABEL.modes[v]])} />
						<Field label="Previous teaching experience" className="ia-wide" error={e.prior_experience}><textarea className="form-control" rows={4} {...input("prior_experience")} /></Field>
					</>
				)}
				<Choices name="levels" legend="Student levels you want to teach" value={form.student_levels} onChange={set("student_levels")} error={e.student_levels} options={STUDENT_LEVELS.map((v) => [v, LABEL.levels[v]])} />
			</Group>

			<Group title="4. Subject expertise">
				<Choices name="subjects" legend="Subjects you want to teach" value={form.subjects.map((s) => s.id)} error={e.subjects} onChange={(ids) => set("subjects")(ids.map((id) => data.categories.find((c) => c.id === id)).filter(Boolean))} options={data.categories.map((c) => [c.id, c.name])} />
				<Field label="Specific topics or skills" className="ia-wide" error={e.topics}><textarea className="form-control" rows={3} {...input("topics")} /></Field>
				<Field label="Language(s) of instruction" required error={e.languages} {...input("languages")} />
				<Field label="Relevant professional or academic experience (optional)" className="ia-wide"><textarea className="form-control" rows={3} {...input("expertise_notes")} /></Field>
			</Group>

			<Group title="5. Teaching demonstration" hint="Show us how you teach. Links must be public https:// addresses (for example an unlisted video). SharpStudy does not host or privately store these files, so use a link you are comfortable sharing with reviewers.">
				<Choices type="radio" name="kind" legend="Your teaching sample" value={form.sample_kind || ""} error={e.sample_kind} onChange={set("sample_kind")} options={SAMPLE_KINDS.map((v) => [v, LABEL.kinds[v]])} />
				{!lessonPlan && <Field label="Link to your sample" type="url" placeholder="https://" error={e.sample_url} {...input("sample_url")} className="ia-wide" />}
				<Field label="Sample lesson title" error={e.sample_title} {...input("sample_title")} />
				<Field label={lessonPlan ? "Written lesson demonstration (detailed outline)" : "Sample lesson outline"} className="ia-wide" error={e.sample_outline} hint={lessonPlan ? "Describe what you would say and do, step by step (at least 150 characters)." : undefined}><textarea className="form-control" rows={6} {...input("sample_outline")} /></Field>
				<Field label="Your teaching methodology" className="ia-wide" error={e.methodology}><textarea className="form-control" rows={4} {...input("methodology")} /></Field>
				<Field label="Worksheet or presentation link (optional)" type="url" placeholder="https://" error={e.material_url} {...input("material_url")} className="ia-wide" />
			</Group>

			<Group title="6. Final details">
				<Field label="Why do you want to teach on SharpStudy?" className="ia-wide" error={e.motivation}><textarea className="form-control" rows={4} {...input("motivation")} /></Field>
				<div className="ia-wide">
					<label className="ia-choice"><input type="checkbox" checked={form.agreed_policies} onChange={(ev) => set("agreed_policies")(ev.target.checked)} /><span>I agree to the instructor policies and the <Link href="/terms-conditions/"><a>terms and conditions</a></Link>.</span></label>
					{e.agreed_policies && <div className="ss-field-error" role="alert">{e.agreed_policies}</div>}
					<label className="ia-choice"><input type="checkbox" checked={form.consented_privacy} onChange={(ev) => set("consented_privacy")(ev.target.checked)} /><span>I consent to SharpStudy reviewing this application under the <Link href="/privacy-policy/"><a>privacy policy</a></Link>. Qualifications are reviewed as evidence and are not independently verified unless we tell you so.</span></label>
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

export default ApplicationForm;
