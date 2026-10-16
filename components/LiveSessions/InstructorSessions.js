import React, { useCallback, useEffect, useState } from "react";
import axios from "axios";
import Link from "next/link";
import { Button, EmptyState } from "@/components/ui";
import { errMessage, fmtWhen, Status, TYPE_LABEL, BUCKETS } from "./format";
import { Field } from "./SessionRoom";

const blank = () => ({
	title: "",
	description: "",
	courseId: "",
	sessionType: "group",
	capacity: 30,
	date: "",
	time: "",
	durationMin: 60,
	timeZone: typeof Intl !== "undefined" ? Intl.DateTimeFormat().resolvedOptions().timeZone : "UTC",
});

// Students come from the server for the chosen course only (paid enrolments of a course you own).
const StudentPicker = ({ courseId, type, selected, setSelected }) => {
	const [data, setData] = useState(null);
	const [error, setError] = useState(null);
	const [q, setQ] = useState("");

	useEffect(() => {
		setSelected([]);
		setData(null);
		setError(null);
		if (!courseId) return;
		let alive = true;
		axios
			.get("/api/live-sessions/students", { params: { courseId } })
			.then((r) => alive && setData(r.data))
			.catch((e) => alive && setError(errMessage(e)));
		return () => {
			alive = false;
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [courseId]);

	if (!courseId) return <p className="ss-muted">Choose a course to see its students.</p>;
	if (error) return <div className="ss-alert ss-alert--danger" role="alert">{error}</div>;
	if (!data) return <p className="ss-muted" role="status">Loading students…</p>;
	if (data.students.length === 0) return <p className="ss-muted">No student has purchased this course yet, so nobody can be assigned.</p>;

	const needle = q.trim().toLowerCase();
	const shown = data.students.filter((u) => !needle || u.name.toLowerCase().includes(needle) || u.email.toLowerCase().includes(needle));
	const one = type === "one_to_one";
	const toggle = (id) => setSelected(one ? [id] : selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);

	return (
		<fieldset className="ss-session__students">
			<legend className="form-label">{one ? "Student (choose one)" : "Students"}</legend>
			<input type="search" className="form-control" placeholder="Search by name or e-mail" aria-label="Search students" value={q} onChange={(e) => setQ(e.target.value)} />
			<div className="ss-session__students-bar">
				<span role="status">{selected.length} selected of {data.students.length}</span>
				{!one && (
					<span>
						<button type="button" className="ss-btn ss-btn--ghost ss-btn--sm" onClick={() => setSelected([...new Set([...selected, ...shown.map((u) => u.id)])])}>Select {needle ? "shown" : "all"}</button>{" "}
						<button type="button" className="ss-btn ss-btn--ghost ss-btn--sm" disabled={!selected.length} onClick={() => setSelected([])}>Clear</button>
					</span>
				)}
			</div>
			<ul className="ss-session__student-list">
				{shown.length === 0 && <li className="ss-muted">No student matches “{q}”.</li>}
				{shown.map((u) => (
					<li key={u.id}>
						<label>
							<input type={one ? "radio" : "checkbox"} name="ls-student" checked={selected.includes(u.id)} onChange={() => toggle(u.id)} />
							<span><strong>{u.name}</strong> <span className="ss-muted">{u.email}</span></span>
						</label>
					</li>
				))}
			</ul>
		</fieldset>
	);
};

const CreateForm = ({ courses, onCreated }) => {
	const [f, setF] = useState(blank);
	const [students, setStudents] = useState([]);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState(null);
	const [notice, setNotice] = useState(null);
	const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
	const one = f.sessionType === "one_to_one";

	const submit = async (e) => {
		e.preventDefault();
		setError(null);
		const capacity = one ? 1 : Number(f.capacity);
		if (one && students.length !== 1) return setError("Choose the one student for this session.");
		if (!one && students.length > capacity) return setError(`You selected ${students.length} students but there are only ${capacity} seats. Raise the seats or deselect some students.`);
		const course = courses.find((c) => c.id === f.courseId);
		const who = students.length ? `${students.length} selected student${students.length === 1 ? "" : "s"} (they will be notified)` : "every student of the course (open booking)";
		if (!window.confirm(`Schedule "${f.title}" for ${course ? course.title : "this course"} on ${f.date} at ${f.time} (${f.timeZone}), ${f.durationMin} minutes, for ${who}?`)) return;
		setBusy(true);
		try {
			const r = await axios.post("/api/live-sessions", { ...f, capacity, durationMin: Number(f.durationMin), studentIds: students });
			const n = r.data.notified;
			setNotice(students.length ? `Scheduled. ${n && n.created != null ? `${n.created} student${n.created === 1 ? "" : "s"} notified` : "Students will see it in their dashboard"}${n && n.email && n.email.failed ? "; some e-mails could not be sent" : ""}.` : "Scheduled.");
			setF({ ...blank(), courseId: f.courseId });
			setStudents([]);
			onCreated(true);
		} catch (err) {
			setError(errMessage(err));
		} finally {
			setBusy(false);
		}
	};

	return (
		<form className="ss-card ss-session__form" onSubmit={submit} aria-label="Schedule a live session">
			<h3 className="ss-session__h">Schedule a session</h3>
			<Field label="Title" id="ls-title"><input id="ls-title" className="form-control" required minLength={3} maxLength={160} value={f.title} onChange={set("title")} /></Field>
			<Field label="Course" id="ls-course">
				<select id="ls-course" className="form-control" required value={f.courseId} onChange={set("courseId")}>
					<option value="">Choose one of your courses…</option>
					{courses.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
				</select>
			</Field>
			<Field label="Format" id="ls-type">
				<select id="ls-type" className="form-control" value={f.sessionType} onChange={(e) => { setF({ ...f, sessionType: e.target.value }); setStudents([]); }}>
					<option value="group">Group class</option>
					<option value="one_to_one">One-to-one (one assigned student)</option>
				</select>
			</Field>
			{!one && (
				<Field label="Seats (capacity)" id="ls-cap"><input id="ls-cap" type="number" min={2} max={500} className="form-control" required value={f.capacity} onChange={set("capacity")} /></Field>
			)}
			<StudentPicker courseId={f.courseId} type={f.sessionType} selected={students} setSelected={setStudents} />
			{!one && students.length === 0 && f.courseId && <p className="ss-muted">No students selected: every student who bought this course can reserve a seat until it is full.</p>}
			<Field label="Date" id="ls-date"><input id="ls-date" type="date" className="form-control" required value={f.date} onChange={set("date")} /></Field>
			<Field label="Start time" id="ls-time"><input id="ls-time" type="time" className="form-control" required value={f.time} onChange={set("time")} /></Field>
			<Field label="Time zone" id="ls-tz"><input id="ls-tz" className="form-control" required value={f.timeZone} onChange={set("timeZone")} /></Field>
			<Field label="Duration (minutes)" id="ls-dur"><input id="ls-dur" type="number" min={15} max={240} className="form-control" required value={f.durationMin} onChange={set("durationMin")} /></Field>
			<Field label="Description (optional)" id="ls-desc"><textarea id="ls-desc" rows={2} maxLength={2000} className="form-control" value={f.description} onChange={set("description")} /></Field>
			<p className="ss-muted">Students are already paid for through the course; scheduling a session never charges anyone.</p>
			{error && <div className="ss-alert ss-alert--danger" role="alert">{error}</div>}
			{notice && <div className="ss-alert" role="status">{notice}</div>}
			<Button type="submit" disabled={busy}>{busy ? "Scheduling…" : "Schedule session"}</Button>
		</form>
	);
};

const InstructorSessions = () => {
	const [sessions, setSessions] = useState(null);
	const [courses, setCourses] = useState([]);
	const [error, setError] = useState(null);
	const [tab, setTab] = useState("upcoming");
	const [creating, setCreating] = useState(false);

	const load = useCallback(async () => {
		try {
			const [s, c] = await Promise.all([axios.get("/api/live-sessions", { params: { scope: "teaching" } }), axios.get("/api/courses")]);
			setSessions(s.data.sessions);
			setCourses(c.data.courses || []);
			setError(null);
		} catch (e) {
			setError(errMessage(e));
		}
	}, []);
	useEffect(() => {
		load();
	}, [load]);

	if (error) return <div className="ss-alert ss-alert--danger" role="alert">{error}</div>;
	if (!sessions) return <p className="ss-muted" role="status">Loading sessions…</p>;

	const counts = Object.fromEntries(BUCKETS.map((b) => [b.key, sessions.filter(b.test).length]));
	const bucket = BUCKETS.find((b) => b.key === tab);
	// Soonest first for what is coming, most recent first for what is over.
	const shown = sessions.filter(bucket.test);
	if (tab === "completed" || tab === "cancelled") shown.reverse();

	return (
		<div className="ss-session">
			{courses.length === 0 ? (
				<EmptyState icon="ri-book-2-line" title="Create a course first" description="Live sessions belong to one of your courses, and only students who purchased it can book them." action={<Button href="/instructor/course/create/">Create a course</Button>} />
			) : creating ? (
				<>
					<CreateForm courses={courses} onCreated={() => { load(); }} />
					<p><Button variant="ghost" size="sm" onClick={() => setCreating(false)}>Close</Button></p>
				</>
			) : (
				<p><Button onClick={() => setCreating(true)} icon="ri-add-line">Schedule a session</Button></p>
			)}

			<nav className="ss-tabs" aria-label="Session status">
				{BUCKETS.map((b) => (
					<a key={b.key} href={`#${b.key}`} className={tab === b.key ? "active" : ""} aria-current={tab === b.key ? "page" : undefined} onClick={(e) => { e.preventDefault(); setTab(b.key); }}>
						{b.label} ({counts[b.key]})
					</a>
				))}
			</nav>

			{shown.length === 0 ? (
				<EmptyState icon="ri-calendar-event-line" title={`No ${bucket.label.toLowerCase()} sessions`} description={tab === "upcoming" ? "Schedule a session and it will appear here." : "Nothing to show."} />
			) : (
				<ul className="ss-session__list">
					{shown.map((s) => (
						<li key={s.id} className="ss-card ss-session__row">
							<div>
								<strong>{s.title}</strong> <Status session={s} />
								<p className="ss-muted">{s.courseTitle} · {TYPE_LABEL[s.sessionType]} · {fmtWhen(s)}</p>
								<p className="ss-muted">{s.seatsTaken}/{s.capacity} {s.sessionType === "one_to_one" ? "booked" : "seats taken"}</p>
							</div>
							<Link href={`/instructor/live/${s.id}/`}><a className="ss-btn ss-btn--sm">{s.status === "live" ? "Open live" : s.status === "scheduled" ? "Manage / start" : "Details"}</a></Link>
						</li>
					))}
				</ul>
			)}
		</div>
	);
};

export default InstructorSessions;
