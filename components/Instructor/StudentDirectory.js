// The instructor's student directory (the existing /instructor/students page).
// One row per person; everything comes from /api/instructor/students, which only returns people in
// the instructor's own scope. Assigning goes through the existing assignment flow, and the details
// panel reuses the existing assignments panel and learner dashboard API.
import React, { useCallback, useEffect, useRef, useState } from "react";
import axios from "axios";
import Link from "next/link";
import { EmptyState, StatTile, ProgressBar } from "@/components/ui";
import { api } from "@/lib/mastery-client/api";
import { GRADES } from "@/lib/mastery/profile";
import LearnerForm, { ProfileFields, profilePayload, SUBJECT_OPTIONS } from "@/components/Mastery/LearnerForm";
import AssignmentsPanel from "@/components/Mastery/AssignmentsPanel";
import AssignWorksheet from "@/components/Mastery/AssignWorksheet";

const STATUS = {
	no_profile: { label: "No learner profile", tone: "warning" },
	no_work: { label: "No work assigned", tone: "" },
	not_started: { label: "Not started", tone: "" },
	in_progress: { label: "In progress", tone: "primary" },
	overdue: { label: "Overdue", tone: "danger" },
	all_done: { label: "All done", tone: "success" },
};
const subjectName = (id) => (SUBJECT_OPTIONS.find((s) => s.id === id) || {}).name || id;
const when = (d) => (d ? new Date(d).toLocaleDateString(undefined, { dateStyle: "medium" }) : "–");
const msg = (e) => (e.response && e.response.data && e.response.data.message) || e.message || "Something went wrong.";

const Avatar = ({ s }) => {
	if (s.photo) {
		return (
			<span className="sd-avatar" aria-hidden="true">
				{/* eslint-disable-next-line @next/next/no-img-element */}
				<img src={s.photo} alt="" />
			</span>
		);
	}
	return (
		<span className="sd-avatar" aria-hidden="true">
			{s.avatar || (s.name || "?").slice(0, 1).toUpperCase()}
		</span>
	);
};
// An e-mail may break before the @ (so the column can be narrow) but is never cut or abbreviated.
const Email = ({ value }) => {
	const at = value.indexOf("@");
	return at < 0 ? value : <>{value.slice(0, at)}<wbr />{value.slice(at)}</>;
};
const Badge = ({ status }) => {
	const b = STATUS[status] || STATUS.no_work;
	return <span className={`ss-badge${b.tone ? ` ss-badge--${b.tone}` : ""}`}>{b.label}</span>;
};
const CourseBadges = ({ courses }) =>
	courses.length === 0 ? <span className="ss-muted">–</span> : (
		<>
			{courses.slice(0, 2).map((c) => <span key={c.id} className="ss-badge">{c.title}</span>)}
			{courses.length > 2 && <span className="ss-badge" title={courses.slice(2).map((c) => c.title).join(", ")}>+{courses.length - 2} more</span>}
		</>
	);

// ------------------------------------------------------------- details

const Detail = ({ row, onClose, onChanged, onAssign }) => {
	const [dash, setDash] = useState(null);
	const [error, setError] = useState(null);
	const [refreshError, setRefreshError] = useState(null);
	const [note, setNote] = useState(null);
	const [creating, setCreating] = useState(false);
	const [linking, setLinking] = useState(false);
	const [candidates, setCandidates] = useState(null);
	const [pick, setPick] = useState("");
	const [confirm, setConfirm] = useState(false);
	const [form, setForm] = useState(null);
	const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

	const load = useCallback(() => {
		if (!row.learnerId) return Promise.resolve();
		return api
			.get(`/learners/${row.learnerId}`, { learner: false })
			.then((d) => {
				setDash(d);
				setError(null);
				setRefreshError(null);
				const p = d.profile || {};
				setForm({ grade: d.learner.grade || "", ageMode: p.birthDate ? "dob" : "age", age: d.learner.age == null ? "" : String(d.learner.age), birthDate: p.birthDate || "", contactName: p.contactName || "", contactPhone: p.contactPhone || "", contactEmail: p.contactEmail || "" });
			})
			.catch((e) => (dash ? setRefreshError(e.message) : setError(e.message)));
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [row.learnerId]);
	useEffect(() => {
		setDash(null);
		setError(null);
		setNote(null);
		load();
	}, [load, row.key]);

	const post = async (body, done) => {
		setNote(null);
		try {
			await axios.post("/api/instructor/students/link", body);
			setNote({ ok: true, text: done });
			setCreating(false);
			setLinking(false);
			onChanged();
		} catch (e) {
			setNote({ ok: false, text: msg(e) });
		}
	};
	const loadCandidates = async () => {
		setLinking(true);
		try {
			const r = await axios.get("/api/instructor/students", { params: { state: "profile_only", all: 1 } });
			setCandidates(r.data.students);
		} catch (e) {
			setNote({ ok: false, text: msg(e) });
		}
	};
	const saveProfile = async (e) => {
		e.preventDefault();
		setNote(null);
		try {
			await api.patch(`/learners/${row.learnerId}`, { ...profilePayload(form), grade: form.grade || null }, { learner: false });
			setNote({ ok: true, text: "Profile saved." });
			load();
			onChanged();
		} catch (err) {
			setNote({ ok: false, text: err.message });
		}
	};

	return (
		<section className="ml-card sd-detail" aria-labelledby="sd-detail-title">
			<div className="sd-detail__head">
				<div className="sd-detail__who">
					<Avatar s={row} />
					<div>
						<h2 id="sd-detail-title" className="ml-h2">{row.name}</h2>
						<p className="ml-muted ml-small">
							{row.email || "Learner profile (no student account)"} · {row.gradeLabel || "Grade not set"}
							{row.age != null ? ` · age ${row.age}` : ""}
						</p>
					</div>
				</div>
				<button type="button" className="ss-btn ss-btn--ghost ss-btn--sm" onClick={onClose}>Close</button>
			</div>

			{row.courses.length > 0 && (
				<div>
					<h3 className="ml-h3">Courses</h3>
					<ul className="sd-courses">
						{row.courses.map((c) => (
							<li key={c.id}>
								<strong>{c.title}</strong> <span className="ml-muted ml-small">enrolled {when(c.enrolledAt)}</span>
								{c.lessons > 0 ? <ProgressBar value={Math.round((c.completed / c.lessons) * 100)} label={`${c.completed} of ${c.lessons} lessons`} /> : <span className="ml-muted ml-small"> · no lessons yet</span>}
							</li>
						))}
					</ul>
				</div>
			)}

			{note && <p className={`ml-note ${note.ok ? "ml-note--info" : "ml-note--danger"}`} role={note.ok ? "status" : "alert"}>{note.text}</p>}

			{!row.learnerId && row.profileState === "needs_profile" && (
				<div className="sd-onboard">
					<h3 className="ml-h3">Learner profile needed</h3>
					<p>
						Worksheets, PIN sessions, stars and progress belong to a <strong>learner profile</strong>. {row.name} has a SharpStudy account but no profile yet, so a worksheet can&apos;t be assigned.
						Nothing is linked automatically: create a profile for this student, or link one you already manage.
					</p>
					{!creating && !linking && (
						<div className="ml-row ml-row--wrap">
							<button type="button" className="ss-btn ss-btn--sm" onClick={() => setCreating(true)}>Create a profile for {row.name}</button>
							<button type="button" className="ss-btn ss-btn--ghost ss-btn--sm" onClick={loadCandidates}>Link a profile I already manage</button>
						</div>
					)}
					{creating && (
						<>
							<p className="ml-hint">Choose a 4-digit PIN and give it to the student: they sign in to SharpStudy as usual, open Study and enter the PIN.</p>
							<LearnerForm
								initialName={row.name.slice(0, 40)}
								submitFn={async (payload) => (await axios.post("/api/instructor/students/link", { action: "create", studentUserId: row.userId, ...payload })).data}
								onCreated={() => {
									setCreating(false);
									setNote({ ok: true, text: `Learner profile created and linked to ${row.name}.` });
									onChanged();
								}}
								onCancel={() => setCreating(false)}
							/>
						</>
					)}
					{linking && (
						<form
							className="ml-form"
							onSubmit={(e) => {
								e.preventDefault();
								post({ action: "link", studentUserId: row.userId, learnerId: pick, confirm: true }, `Linked to ${row.name}.`);
							}}
						>
							{candidates === null ? <p className="ml-loading" role="status">Loading your profiles…</p> : candidates.length === 0 ? (
								<p className="ml-muted">You have no unlinked learner profiles. Create a new one instead.</p>
							) : (
								<>
									<div className="ml-field">
										<label htmlFor="sd-pick">Profile to link</label>
										<select id="sd-pick" className="ml-text" required value={pick} onChange={(e) => setPick(e.target.value)}>
											<option value="">Choose a profile…</option>
											{candidates.map((c) => <option key={c.learnerId} value={c.learnerId}>{c.name}{c.gradeLabel ? ` (${c.gradeLabel})` : ""}</option>)}
										</select>
									</div>
									<label className="ml-check-row">
										<input type="checkbox" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} />
										I confirm that {row.name} may sign in to this profile and see its progress. Its existing progress stays with the profile.
									</label>
									<div className="ml-row">
										<button type="submit" className="ss-btn ss-btn--sm" disabled={!pick || !confirm}>Link profile</button>
										<button type="button" className="ss-btn ss-btn--ghost ss-btn--sm" onClick={() => setLinking(false)}>Cancel</button>
									</div>
								</>
							)}
						</form>
					)}
				</div>
			)}
			{!row.learnerId && row.profileState === "managed_elsewhere" && (
				<p className="ml-note" role="note">This student already has a learner profile managed by another instructor or family, so it can&apos;t be used here.</p>
			)}

			{row.learnerId && (
				<>
					{error && <p className="ml-note ml-note--danger" role="alert">{error}</p>}
					{!dash && !error && <p className="ml-loading" role="status">Loading progress…</p>}
					{dash && (
						<>
							<div className="ml-stats">
								<StatTile icon="ri-flag-2-line" value={`${dash.todayCount}/${dash.dailyGoal}`} label="Today's goal" />
								<StatTile icon="ri-fire-line" tone="accent" value={dash.streak.current} label="Day streak" />
								<StatTile icon="ri-star-fill" tone="accent" value={dash.totalStars} label="Stars" />
							</div>
							<h3 className="ml-h3">Subjects</h3>
							{dash.subjects.filter((s) => s.active).length === 0 ? <p className="ml-muted">No subjects switched on.</p> : (
								<ul className="sd-courses">
									{dash.subjects.filter((s) => s.active).map((s) => (
										<li key={s.id}><strong>{s.name}</strong> <span className="ml-muted ml-small">{s.position ? `${s.position.levelTitle} · ${s.position.setTitle}` : ""}</span><ProgressBar value={Math.round(s.progress * 100)} label={`${s.name} ladder progress`} /></li>
									))}
								</ul>
							)}
							<AssignmentsPanel
								items={dash.assignments}
								counts={dash.assignmentCounts}
								mode="adult"
								canManage={dash.access.place}
								onChanged={() => {
									load();
									onChanged();
								}}
								lastUpdateAt={dash.lastUpdateAt}
								stale={dash.lastUpdateAt ? `last activity ${new Date(dash.lastUpdateAt).toLocaleString()}` : null}
								onRefresh={load}
								error={refreshError ? `Could not refresh: ${refreshError}` : null}
							/>
							<div className="ml-row ml-row--wrap">
								{row.canAssign && <button type="button" className="ss-btn ss-btn--sm" onClick={() => onAssign([row])}>Assign a worksheet</button>}
								<Link href={`/family/?learner=${row.learnerId}`}><a className="ss-btn ss-btn--ghost ss-btn--sm">Open full learner dashboard</a></Link>
								{row.userId && dash.access.place && (
									<button type="button" className="ss-btn ss-btn--ghost ss-btn--sm" onClick={() => window.confirm(`Unlink this profile from ${row.name}? The profile and its progress stay; the student loses access to it.`) && post({ action: "unlink", learnerId: row.learnerId }, "Unlinked. The profile and its progress were kept.")}>
										Unlink profile
									</button>
								)}
							</div>
							{dash.profile && form && (
								<form className="ml-form" onSubmit={saveProfile} aria-label="Edit profile">
									<h3 className="ml-h3">Profile</h3>
									<ProfileFields form={form} set={set} idPrefix="sd" />
									<div className="ml-row"><button type="submit" className="ss-btn ss-btn--sm">Save profile</button></div>
								</form>
							)}
						</>
					)}
				</>
			)}
		</section>
	);
};

// ------------------------------------------------------------- directory

const blankFilters = { q: "", courseId: "", grade: "", subject: "", status: "" };

const StudentDirectory = () => {
	const [f, setF] = useState(blankFilters);
	const [page, setPage] = useState(1);
	const [data, setData] = useState(null);
	const [error, setError] = useState(null);
	const [loading, setLoading] = useState(true);
	const [open, setOpen] = useState(null);
	const [selected, setSelected] = useState([]);
	const [assigning, setAssigning] = useState(null);
	const timer = useRef(null);
	const reqId = useRef(0);

	const load = useCallback(() => {
		const id = ++reqId.current;
		setLoading(true);
		return axios
			.get("/api/instructor/students", { params: { ...Object.fromEntries(Object.entries(f).filter(([, v]) => v)), page } })
			.then((r) => {
				if (id !== reqId.current) return;
				setData(r.data);
				setError(null);
				setPage(r.data.page);
			})
			.catch((e) => id === reqId.current && setError(msg(e)))
			.finally(() => id === reqId.current && setLoading(false));
	}, [f, page]);
	useEffect(() => {
		clearTimeout(timer.current);
		timer.current = setTimeout(load, f.q ? 250 : 0);
		return () => clearTimeout(timer.current);
	}, [load, f.q]);

	const setFilter = (k) => (e) => {
		setF({ ...f, [k]: e.target.value });
		setPage(1);
	};
	const filtered = Object.values(f).some(Boolean);
	const rows = data ? data.students : [];
	const toggle = (key) => setSelected((s) => (s.includes(key) ? s.filter((x) => x !== key) : [...s, key]));
	const chosen = rows.filter((r) => selected.includes(r.key) && r.canAssign);
	const openRow = open && (rows.find((r) => r.key === open) || null);

	const assignStudents = (list) => ({
		list: list.map((r) => ({ id: r.learnerId, displayName: r.name, avatar: r.avatar || "🙂", grade: r.grade, gradeLabel: r.gradeLabel, subjects: r.subjects })),
		pre: list.map((r) => r.learnerId),
	});

	if (assigning) {
		const a = assignStudents(assigning);
		return (
			<AssignWorksheet
				students={a.list}
				preselect={a.pre}
				onCancel={() => setAssigning(null)}
				onDone={() => {
					setAssigning(null);
					setSelected([]);
					load();
				}}
			/>
		);
	}

	return (
		<div className="sd">
			{data && (
				<div className="sd-summary" aria-label="Summary">
					<StatTile icon="ri-group-line" value={data.summary.total} label="Students" />
					<StatTile icon="ri-pulse-line" tone="success" value={data.summary.activeLearners} label="Active learners (14 days)" />
					<StatTile icon="ri-time-line" tone="accent" value={data.summary.openAssignments} label="Pending assignments" />
					<StatTile icon="ri-checkbox-circle-line" tone="success" value={data.summary.completedAssignments} label="Completed assignments" />
				</div>
			)}
			{data && data.summary.needProfile > 0 && (
				<p className="ml-note ml-note--info" role="note">
					{data.summary.needProfile} student{data.summary.needProfile === 1 ? " has" : "s have"} no learner profile yet. Open a student to create or link one so they can receive worksheets.
				</p>
			)}

			<form className="sd-filters" role="search" onSubmit={(e) => e.preventDefault()}>
				<div className="ml-field">
					<label htmlFor="sd-q">Search name or e-mail</label>
					<input id="sd-q" type="search" className="ml-text" value={f.q} onChange={setFilter("q")} />
				</div>
				<div className="ml-field">
					<label htmlFor="sd-course">Course</label>
					<select id="sd-course" className="ml-text" value={f.courseId} onChange={setFilter("courseId")}>
						<option value="">All my courses</option>
						{data && data.courses.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
					</select>
				</div>
				<div className="ml-field">
					<label htmlFor="sd-grade">Grade</label>
					<select id="sd-grade" className="ml-text" value={f.grade} onChange={setFilter("grade")}>
						<option value="">All grades</option>
						{GRADES.map((g) => <option key={g.code} value={g.code}>{g.label}</option>)}
					</select>
				</div>
				<div className="ml-field">
					<label htmlFor="sd-subject">Subject</label>
					<select id="sd-subject" className="ml-text" value={f.subject} onChange={setFilter("subject")}>
						<option value="">All subjects</option>
						{SUBJECT_OPTIONS.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
					</select>
				</div>
				<div className="ml-field">
					<label htmlFor="sd-status">Learning status</label>
					<select id="sd-status" className="ml-text" value={f.status} onChange={setFilter("status")}>
						<option value="">Any status</option>
						{Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
					</select>
				</div>
			</form>

			{error && (
				<div className="ss-alert ss-alert--danger" role="alert">
					{error} <button type="button" className="ml-linklike" onClick={load}>Try again</button>
				</div>
			)}
			{!data && !error && <p className="ss-muted" role="status">Loading students…</p>}

			{data && (
				<p className="ml-muted ml-small" role="status" aria-live="polite">
					{loading ? "Updating…" : `Showing ${rows.length} of ${data.total} student${data.total === 1 ? "" : "s"}`}
					{filtered && <> · <button type="button" className="ml-linklike" onClick={() => { setF(blankFilters); setPage(1); }}>Clear filters</button></>}
				</p>
			)}

			{openRow && <Detail key={openRow.key} row={openRow} onClose={() => setOpen(null)} onChanged={load} onAssign={setAssigning} />}

			{chosen.length > 0 && (
				<div className="sd-bulk" role="region" aria-label="Selected students">
					<span>{chosen.length} selected</span>
					<button type="button" className="ss-btn ss-btn--sm" onClick={() => setAssigning(chosen)}>Assign worksheet</button>
					<button type="button" className="ss-btn ss-btn--ghost ss-btn--sm" onClick={() => setSelected([])}>Clear</button>
				</div>
			)}

			{data && rows.length === 0 && !loading && (
				filtered ? (
					<EmptyState icon="ri-search-line" title="No student matches these filters" description="Try a different search or clear the filters." />
				) : (
					<EmptyState icon="ri-group-line" title="No students yet" description="Students who buy one of your courses appear here. You can also create learner profiles on the Learners page." />
				)
			)}

			{rows.length > 0 && (
				<>
					<div className="sd-table table-responsive">
						<table className="table align-middle fs-14">
							<caption className="visually-hidden">Students</caption>
							<thead>
								<tr>
									<th scope="col" className="sd-col-pick"><span className="visually-hidden">Select</span></th>
									<th scope="col" className="sd-col-student">Student</th>
									<th scope="col" className="sd-col-grade">Grade</th>
									<th scope="col" className="sd-col-subjects">Subjects</th>
									<th scope="col" className="sd-col-courses">Courses</th>
									<th scope="col" className="sd-col-assign">Assignments</th>
									<th scope="col" className="sd-col-last">Last activity</th>
									<th scope="col" className="sd-col-actions"><span className="visually-hidden">Actions</span></th>
								</tr>
							</thead>
							<tbody>
								{rows.map((s) => (
									<tr key={s.key} className={open === s.key ? "is-open" : ""}>
										<td className="sd-col-pick">
											<input type="checkbox" disabled={!s.canAssign} checked={selected.includes(s.key)} onChange={() => toggle(s.key)} aria-label={s.canAssign ? `Select ${s.name}` : `${s.name} cannot be assigned work yet`} />
										</td>
										<td className="sd-col-student">
											<div className="sd-who"><Avatar s={s} /><div className="sd-who__text"><strong className="sd-name">{s.name}</strong>{s.email && <span className="sd-email"><Email value={s.email} /></span>}</div></div>
										</td>
										<td className="sd-col-grade">{s.gradeLabel || <span className="ss-muted">–</span>}{s.age != null && <span className="ss-muted"> · {s.age}y</span>}</td>
										<td className="sd-col-subjects">{s.subjects.length ? s.subjects.map(subjectName).join(", ") : <span className="ss-muted">–</span>}</td>
										<td className="sd-col-courses"><div className="sd-badges"><CourseBadges courses={s.courses} /></div></td>
										<td className="sd-col-assign">
											<Badge status={s.status} />
											{s.counts.assigned > 0 && <div className="ml-small">{s.counts.completed}/{s.counts.assigned} done{s.counts.overdue > 0 && ` · ${s.counts.overdue} overdue`}</div>}
										</td>
										<td className="sd-col-last">{when(s.lastActivityAt)}</td>
										<td className="sd-col-actions sd-actions">
											<button type="button" className="ss-btn ss-btn--secondary ss-btn--sm" aria-expanded={open === s.key} onClick={() => setOpen(open === s.key ? null : s.key)}>View details</button>
											{s.canAssign ? <button type="button" className="ss-btn ss-btn--sm" onClick={() => setAssigning([s])}>Assign worksheet</button> : s.profileState === "needs_profile" ? <button type="button" className="ss-btn ss-btn--secondary ss-btn--sm" onClick={() => setOpen(s.key)}>Set up profile</button> : null}
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>

					<ul className="sd-cards">
						{rows.map((s) => (
							<li key={s.key} className="ml-card">
								<div className="sd-who"><Avatar s={s} /><div className="sd-who__text"><strong className="sd-name">{s.name}</strong>{s.email && <span className="sd-email"><Email value={s.email} /></span>}</div></div>
								<p className="ml-small">{s.gradeLabel || "Grade not set"}{s.age != null ? ` · age ${s.age}` : ""} · {s.subjects.length ? s.subjects.map(subjectName).join(", ") : "no subjects"}</p>
								<p className="sd-badges"><CourseBadges courses={s.courses} /></p>
								<p><Badge status={s.status} /> {s.counts.assigned > 0 && <span className="ml-small">{s.counts.completed}/{s.counts.assigned} done</span>}</p>
								<p className="ml-muted ml-small">Last activity: {when(s.lastActivityAt)}</p>
								<div className="ml-row ml-row--wrap">
									{s.canAssign && <label className="ml-check-row"><input type="checkbox" checked={selected.includes(s.key)} onChange={() => toggle(s.key)} /> Select</label>}
									<button type="button" className="ss-btn ss-btn--secondary ss-btn--sm" onClick={() => setOpen(open === s.key ? null : s.key)}>View details</button>
									{s.canAssign && <button type="button" className="ss-btn ss-btn--sm" onClick={() => setAssigning([s])}>Assign worksheet</button>}
								</div>
							</li>
						))}
					</ul>
				</>
			)}

			{data && data.pages > 1 && (
				<nav className="ia-pager" aria-label="Pagination">
					<button type="button" className="ss-btn ss-btn--ghost ss-btn--sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button>
					<span>Page {data.page} of {data.pages}</span>
					<button type="button" className="ss-btn ss-btn--ghost ss-btn--sm" disabled={page >= data.pages} onClick={() => setPage(page + 1)}>Next</button>
				</nav>
			)}
		</div>
	);
};

export default StudentDirectory;
