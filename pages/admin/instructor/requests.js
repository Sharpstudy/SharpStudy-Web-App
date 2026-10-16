import React, { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/router";
import axios from "axios";
import toast from "react-hot-toast";
import AdminLayout from "@/components/_App/AdminLayout";
import GeneralLoader from "@/utils/GeneralLoader";
import { EmptyState } from "@/components/ui";
import { StatusBadge, STATUS_LABEL } from "@/components/BecomeAInstructor/ApplicationForm";
import { RUBRIC_KEYS } from "@/lib/instructor-applications/rules";

// Admin > Instructors > Requests. Reads and acts through /api/instructor/requests; every call is
// authorised on the server (admin role re-read from the database), so nothing here grants access.
const API = "/api/instructor/requests";
const msg = (e) => (e.response && e.response.data && e.response.data.message) || "Something went wrong.";
const fmt = (d) => (d ? new Date(d).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "–");
const RUBRIC_LABEL = { subject_knowledge: "Subject knowledge", teaching_clarity: "Teaching clarity", lesson_structure: "Lesson structure", communication: "Communication", level_appropriateness: "Appropriate for student level", sample_quality: "Quality of teaching sample", qualifications_experience: "Qualifications & experience" };
const CARDS = [["pending", "Pending", "ri-time-line"], ["under_review", "Under review", "ri-search-eye-line"], ["more_info_requested", "More info requested", "ri-question-line"], ["approved", "Approved", "ri-checkbox-circle-line"], ["rejected", "Rejected", "ri-close-circle-line"]];
const ACTIONS = {
	start_review: { label: "Start review", variant: "" },
	request_info: { label: "Request more information", variant: "", feedback: "Message to the applicant (what do you need?)" },
	approve: { label: "Approve", variant: "success", confirm: "Approve this applicant? Their account will immediately receive instructor access.", feedback: "Message to the applicant (optional)", optional: true },
	reject: { label: "Reject", variant: "danger", confirm: "Reject this application? The applicant stays a student and is told why.", feedback: "Reason / next steps for the applicant" },
	revoke: { label: "Revoke instructor access", variant: "danger", confirm: "Remove this person's instructor access? They become a student; their courses stay but they can no longer manage them.", feedback: "Reason shown to the applicant" },
};
const Row = ({ k, children }) => children ? <div className="ia-row"><dt>{k}</dt><dd>{children}</dd></div> : null;
const Link2 = ({ href }) => href ? <a href={href} target="_blank" rel="noopener noreferrer nofollow">{href}</a> : null;

const Detail = ({ id, onChanged, onClose }) => {
	const [a, setA] = useState(null);
	const [error, setError] = useState("");
	const [notes, setNotes] = useState("");
	const [rubric, setRubric] = useState({});
	const [pending, setPending] = useState(null); // action awaiting confirmation
	const [feedback, setFeedback] = useState("");
	const [busy, setBusy] = useState(false);
	const busyRef = useRef(false);

	const apply = (app) => {
		setA(app);
		setNotes(app.admin_notes || "");
		setRubric(app.rubric || {});
	};
	const load = useCallback(async () => {
		try {
			apply((await axios.get(API, { params: { id } })).data.application);
			setError("");
		} catch (e) {
			setError(msg(e));
		}
	}, [id]);
	useEffect(() => {
		setA(null);
		setPending(null);
		load();
	}, [load]);

	const post = async (body, ok) => {
		if (busyRef.current) return;
		busyRef.current = true;
		setBusy(true);
		try {
			const { data } = await axios.post(API, { id, ...body });
			apply(data.application);
			setPending(null);
			setFeedback("");
			toast.success(ok);
			onChanged();
		} catch (e) {
			toast.error(msg(e));
			load();
		} finally {
			busyRef.current = false;
			setBusy(false);
		}
	};

	if (error && !a) return <div className="ss-alert ss-alert--danger" role="alert">{error}</div>;
	if (!a) return <p className="ss-muted" role="status">Loading…</p>;
	const p = pending && ACTIONS[pending];
	const needsText = p && !p.optional && p.feedback;
	const person = a.applicant || {};

	return (
		<section className="ia-detail" aria-label={`Application from ${a.full_name || person.name}`}>
			<div className="ia-head">
				<div>
					<h2>{a.full_name || person.name}</h2>
					<p className="ss-muted">{person.email} {!person.email_confirmed && <span className="ss-badge ss-badge--warning">Email not verified</span>} · attempt {a.attempt} · submitted {fmt(a.submitted_at)}</p>
				</div>
				<div className="ia-head__side"><StatusBadge status={a.status} /><button type="button" className="ss-btn ss-btn--ghost ss-btn--sm" onClick={onClose}>Close</button></div>
			</div>
			<p className="ss-muted ia-note">Qualifications and links below are what the applicant reported. They have <strong>not</strong> been independently verified.</p>

			<div className="ia-cols">
				<dl className="ia-summary ia-summary--stack">
					<Row k="Phone">{a.phone}</Row>
					<Row k="Country / location">{[a.country, a.location].filter(Boolean).join(", ")}</Row>
					<Row k="Education">{[a.education_level && a.education_level.replace(/_/g, " "), a.degree, a.institution, a.graduation_year].filter(Boolean).join(" · ")}</Row>
					<Row k="Certifications">{a.certifications}</Row>
					<Row k="Profession">{a.profession}</Row>
					<Row k="Teaching experience">{a.has_teaching_experience ? `${a.teaching_years} year(s), ${(a.teaching_modes || []).join(" & ")}` : "No formal teaching experience (new teacher)"}</Row>
					<Row k="Previous teaching">{a.prior_experience}</Row>
					<Row k="Student levels">{(a.student_levels || []).map((l) => l.replace(/_/g, " ")).join(", ")}</Row>
					<Row k="Subjects">{(a.subjects || []).map((s) => s.name).join(", ")}</Row>
					<Row k="Topics">{a.topics}</Row>
					<Row k="Languages">{a.languages}</Row>
					<Row k="Other expertise">{a.expertise_notes}</Row>
					<Row k="Why SharpStudy">{a.motivation}</Row>
				</dl>
				<dl className="ia-summary ia-summary--stack">
					<Row k="Sample type">{a.sample_kind && a.sample_kind.replace(/_/g, " ")}</Row>
					<Row k="Sample link"><Link2 href={a.sample_url} /></Row>
					<Row k="Sample lesson">{a.sample_title}</Row>
					<Row k="Lesson outline"><span className="ia-pre">{a.sample_outline}</span></Row>
					<Row k="Methodology"><span className="ia-pre">{a.methodology}</span></Row>
					<Row k="Supporting material"><Link2 href={a.material_url} /></Row>
					<Row k="Consent">Policies agreed: {a.agreed_policies ? "yes" : "no"} · Privacy consent: {a.consented_privacy ? "yes" : "no"}</Row>
				</dl>
			</div>

			<h3 className="ss-subhead">Review (private)</h3>
			<div className="ia-rubric">
				{RUBRIC_KEYS.map((k) => (
					<label key={k}>
						<span>{RUBRIC_LABEL[k]}</span>
						<select className="form-control" value={rubric[k] || ""} onChange={(e) => setRubric((r) => ({ ...r, [k]: e.target.value ? Number(e.target.value) : undefined }))}>
							<option value="">–</option>
							{[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}{n === 1 ? " (weak)" : n === 5 ? " (excellent)" : ""}</option>)}
						</select>
					</label>
				))}
			</div>
			<label className="form-label" htmlFor="ia-notes">Private admin notes (never shown to the applicant)</label>
			<textarea id="ia-notes" className="form-control" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={4000} />
			<div className="ia-actions"><button type="button" className="ss-btn ss-btn--ghost ss-btn--sm" disabled={busy} onClick={() => post({ action: "save_review", admin_notes: notes, rubric }, "Review saved.")}>Save notes &amp; rubric</button></div>

			<h3 className="ss-subhead">Decision</h3>
			{a.notify && a.notify.status === "failed" || (a.notify && a.notify.status === "skipped" && a.notify.kind) ? (
				<div className="ss-alert ss-alert--warning" role="status">
					The “{a.notify.kind}” e-mail to the applicant was {a.notify.status === "failed" ? "not delivered" : "not sent (e-mail is not configured)"}. The decision itself is recorded.
					<button type="button" className="ss-btn ss-btn--ghost ss-btn--sm" disabled={busy} onClick={() => post({ action: "retry_email" }, "E-mail retried.")}>Retry e-mail</button>
				</div>
			) : null}
			{!pending ? (
				<div className="ia-actions">
					{a.allowed.length === 0 && <span className="ss-muted">No further action is possible for this status.</span>}
					{a.allowed.map((k) => (
						<button key={k} type="button" className={`ss-btn ss-btn--sm ${ACTIONS[k].variant ? `ss-btn--${ACTIONS[k].variant}` : ""}`} disabled={busy} onClick={() => (k === "start_review" ? post({ action: k }, "Review started.") : setPending(k))}>{ACTIONS[k].label}</button>
					))}
				</div>
			) : (
				<div className="ia-confirm" role="alertdialog" aria-labelledby="ia-confirm-t">
					<p id="ia-confirm-t"><strong>{p.confirm || p.label}</strong></p>
					<label className="form-label" htmlFor="ia-fb">{p.feedback}</label>
					<textarea id="ia-fb" className="form-control" rows={3} value={feedback} onChange={(e) => setFeedback(e.target.value)} maxLength={2000} />
					<div className="ia-actions">
						<button type="button" className="ss-btn ss-btn--ghost ss-btn--sm" disabled={busy} onClick={() => setPending(null)}>Cancel</button>
						<button type="button" className={`ss-btn ss-btn--sm ${p.variant ? `ss-btn--${p.variant}` : ""}`} disabled={busy || (needsText && feedback.trim().length < 10)} onClick={() => post({ action: pending, confirm: true, feedback, admin_notes: notes, rubric }, `${p.label}: done.`)}>Confirm: {p.label}</button>
					</div>
				</div>
			)}

			<h3 className="ss-subhead">Status history</h3>
			<ol className="ia-timeline">
				{a.history.map((h, i) => (
					<li key={i}>
						<strong>{STATUS_LABEL[h.to] || h.to}</strong> <span className="ss-muted">{fmt(h.at)} · {h.actor}</span>
						{h.feedback && <p>To applicant: {h.feedback}</p>}
						{h.internal_note && <p className="ss-muted">Private: {h.internal_note}</p>}
					</li>
				))}
			</ol>
		</section>
	);
};

const Index = ({ user }) => {
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
		<AdminLayout user={user} title="Instructors" description="Review applications to become an instructor.">
			<ul className="nav-style1">
				<li><Link href="/admin/instructor/"><a>Instructors</a></Link></li>
				<li><Link href="/admin/instructor/requests/"><a className="active">Requests</a></Link></li>
			</ul>

			{list && (
				<div className="ia-cards">
					{CARDS.map(([k, label, icon]) => (
						<button key={k} type="button" className={`ia-card-stat ${status === k ? "is-active" : ""}`} aria-pressed={status === k} onClick={() => { setStatus(status === k ? "" : k); setPage(1); }}>
							<i className={icon} aria-hidden="true"></i><strong>{list.counts[k]}</strong><span>{label}</span>
						</button>
					))}
				</div>
			)}

			<div className="ia-filters">
				<label className="visually-hidden" htmlFor="ia-q">Search by name or email</label>
				<input id="ia-q" className="form-control" type="search" placeholder="Search by name or email" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
				<label className="visually-hidden" htmlFor="ia-s">Status</label>
				<select id="ia-s" className="form-control" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
					<option value="">All statuses</option>
					{["pending", "under_review", "more_info_requested", "approved", "rejected", "revoked"].map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
				</select>
			</div>

			{open && <Detail id={open} onChanged={load} onClose={() => setOpen(null)} />}

			{error ? <div className="ss-alert ss-alert--danger" role="alert">{error}</div> : !list ? <GeneralLoader /> : list.applications.length === 0 ? (
				<EmptyState icon="ri-user-add-line" title="No applications found" description={q || status ? "Try a different search or filter." : "When someone applies to become an instructor, their application appears here."} />
			) : (
				<>
					<div className="table-responsive">
						<table className="table align-middle table-hover fs-14">
							<caption className="visually-hidden">Instructor applications</caption>
							<thead><tr><th scope="col">Applicant</th><th scope="col">Phone</th><th scope="col">Subjects</th><th scope="col">Experience</th><th scope="col">Submitted</th><th scope="col">Status</th><th scope="col"><span className="visually-hidden">Action</span></th></tr></thead>
							<tbody>
								{list.applications.map((r) => (
									<tr key={r.id} className={open === r.id ? "table-active" : ""}>
										<td><strong>{r.name}</strong><br /><span className="ss-muted">{r.email}</span></td>
										<td>{r.phone || "–"}</td>
										<td>{r.subjects.join(", ") || "–"}</td>
										<td>{r.has_teaching_experience ? `${r.teaching_years} yr` : "New teacher"}</td>
										<td>{fmt(r.submitted_at)}</td>
										<td><StatusBadge status={r.status} /></td>
										<td><button type="button" className="ss-btn ss-btn--sm ss-btn--ghost" onClick={() => { setOpen(r.id); window.scrollTo && window.scrollTo({ top: 0, behavior: "smooth" }); }}>Review</button></td>
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
		</AdminLayout>
	);
};

export default Index;
