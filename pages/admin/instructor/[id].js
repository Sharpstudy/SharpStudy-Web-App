import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";
import axios from "axios";
import { parseCookies } from "nookies";
import AdminLayout from "@/components/_App/AdminLayout";
import GeneralLoader from "@/utils/GeneralLoader";
import baseUrl from "@/utils/baseUrl";
import { Badge, Button, EmptyState } from "@/components/ui";
import { StatusBadge } from "@/components/Admin/useAccountManager";
import { NA, STATUS_LABEL, STATUS_TONE, formatDate, formatDateOnly, formatHours, formatMinutes, formatPercent, formatTimeRange, orNA } from "@/lib/admin/formatDetails";

const FILTERS = [
	["all", "All sessions"],
	["completed", "Completed"],
	["upcoming", "Upcoming"],
	["cancelled", "Cancelled"],
];

const Stat = ({ label, value, hint, small }) => (
	<div className="ss-stat-mini" title={hint}>
		<strong style={small ? { fontSize: "var(--ss-fs-md, 1.05rem)", lineHeight: 1.6 } : undefined}>{value}</strong>
		<span>{label}</span>
	</div>
);

const Section = ({ title, note, children }) => (
	<section className="mb-4">
		<h2 className="ss-subhead" style={{ marginTop: 0 }}>
			{title}
		</h2>
		{note && <p className="ss-muted fs-14">{note}</p>}
		{children}
	</section>
);

const Field = ({ label, children }) => (
	<>
		<dt className="col-sm-4 col-lg-3">{label}</dt>
		<dd className="col-sm-8 col-lg-9 text-break">{children}</dd>
	</>
);

// Admin only (gated in _app via pageAccess, and the API re-checks the role on every request).
// Everything shown here belongs to the ONE selected instructor; the API filters by that instructor's id.
const InstructorDetails = ({ user }) => {
	const router = useRouter();
	const { id } = router.query;
	const [data, setData] = useState(null);
	const [error, setError] = useState("");
	const [filter, setFilter] = useState("all");

	const load = useCallback(async () => {
		if (!id) return;
		setError("");
		try {
			const { edmy_users_token } = parseCookies();
			const r = await axios.get(`${baseUrl}/api/admin/instructors/${id}`, { headers: { Authorization: edmy_users_token } });
			setData(r.data);
		} catch (e) {
			setData(null);
			setError((e.response && e.response.data && e.response.data.message) || "Could not load this instructor.");
		}
	}, [id]);
	useEffect(() => {
		load();
	}, [load]);

	const sessions = useMemo(() => (data ? data.sessions.filter((s) => filter === "all" || s.status === filter) : []), [data, filter]);
	const counts = useMemo(() => {
		const c = { all: 0 };
		if (data) for (const s of data.sessions) { c.all += 1; c[s.status] = (c[s.status] || 0) + 1; }
		return c;
	}, [data]);

	const back = <Button href="/admin/instructor/" variant="secondary" icon="ri-arrow-left-line">Back to Instructors</Button>;
	const p = data && data.profile;
	const st = data && data.stats;

	return (
		<AdminLayout user={user} title={p ? p.name || "Instructor" : "Instructor details"} description="Profile, teaching history and performance for this instructor only." actions={back}>
			{!data && !error && <GeneralLoader />}
			{error && <EmptyState icon="ri-error-warning-line" title="Instructor unavailable" description={error} action={back} />}
			{data && (
				<>
					<Section title="Profile">
						<dl className="row fs-14 mb-0">
							<Field label="Full name">{orNA(p.name)}</Field>
							<Field label="Email">{orNA(p.email)}</Field>
							<Field label="Phone">{orNA(p.phone)}</Field>
							<Field label="Subject / specialization">{orNA(p.subject)}</Field>
							<Field label="About">{orNA(p.about)}</Field>
							<Field label="Account status">
								<StatusBadge user={{ status: p.status }} />
								{p.anonymized && <span className="ms-2 ss-muted">Anonymized</span>}
							</Field>
							<Field label="Registered">{formatDateOnly(p.registeredAt)}</Field>
						</dl>
					</Section>

					<Section title="Teaching statistics" note="Only this instructor's classes. Cancelled, upcoming and never-started classes are not counted as completed.">
						<div className="ss-statgrid" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))" }}>
							<Stat label="Completed classes" value={st.completedSessions} hint="Classes that were started and finished" />
							<Stat label="Upcoming classes" value={st.upcomingSessions} />
							<Stat label="Cancelled classes" value={st.cancelledSessions} />
							<Stat label="Not held" value={st.notHeldSessions} hint="Scheduled time passed without the class being started" />
							<Stat label="Unique students" value={st.uniqueStudents} hint="Distinct students who joined at least one completed class" />
							<Stat label="Teaching hours" value={formatHours(st.teachingHours)} hint="Recorded start to recorded end of completed classes" />
							<Stat label="Average attendance" value={formatPercent(st.averageAttendance)} hint="Booked students who attended, averaged over completed classes" />
							<Stat label="Courses" value={st.courses} />
							<Stat label="Last class" small value={st.lastConductedAt ? formatDate(st.lastConductedAt, "UTC") : NA} />
							{st.liveSessions > 0 && <Stat label="Live now" value={st.liveSessions} />}
						</div>
						<ul className="ss-muted fs-14 mb-0 ps-3">
							{st.heldSessionsWithoutRecordedDuration > 0 && <li>{st.heldSessionsWithoutRecordedDuration} completed class(es) have no recorded end time and are left out of teaching hours.</li>}
							{st.averageAttendance == null ? <li>Average attendance is N/A: no completed class had booked students to measure against.</li> : <li>Average attendance is based on {st.attendanceSessionsCounted} completed class(es) with booked students.</li>}
							<li>Hours come from the recorded start and end of each class, never from the scheduled length.</li>
						</ul>
					</Section>

					<Section title="Session history">
						<div className="d-flex flex-wrap gap-2 mb-3" role="group" aria-label="Filter sessions by status">
							{FILTERS.map(([key, label]) => (
								<Button key={key} size="sm" variant={filter === key ? "primary" : "secondary"} aria-pressed={filter === key} onClick={() => setFilter(key)}>
									{label} ({counts[key] || 0})
								</Button>
							))}
							{["live", "not_held"].filter((k) => counts[k]).map((k) => (
								<Button key={k} size="sm" variant={filter === k ? "primary" : "secondary"} aria-pressed={filter === k} onClick={() => setFilter(k)}>
									{STATUS_LABEL[k]} ({counts[k]})
								</Button>
							))}
						</div>
						{sessions.length === 0 ? (
							<EmptyState icon="ri-calendar-line" title={data.sessions.length ? "No sessions match this filter" : "No sessions yet"} description={data.sessions.length ? "Try another status." : "This instructor has not scheduled any live classes."} />
						) : (
							<div className="table-responsive">
								<table className="table align-middle table-hover fs-14">
									<thead>
										<tr>
											<th scope="col">Session</th>
											<th scope="col">Course / subject</th>
											<th scope="col">Date</th>
											<th scope="col">Time</th>
											<th scope="col">Duration</th>
											<th scope="col">Registered</th>
											<th scope="col">Attended</th>
											<th scope="col">Status</th>
										</tr>
									</thead>
									<tbody>
										{sessions.map((s) => (
											<tr key={s.id}>
												<td>{s.title}</td>
												<td>{s.course ? `${s.course}` : orNA(s.subject)}</td>
												<td className="text-nowrap">{formatDate(s.startAt, s.timeZone)}</td>
												<td className="text-nowrap">{formatTimeRange(s.startAt, s.endAt, s.timeZone)}</td>
												<td title={`Scheduled: ${formatMinutes(s.scheduledMinutes)}`}>{s.status === "completed" ? formatMinutes(s.actualMinutes) : NA}</td>
												<td>{s.registered}</td>
												<td>{s.attended == null ? NA : s.attended}</td>
												<td>
													<Badge tone={STATUS_TONE[s.status]}>{STATUS_LABEL[s.status]}</Badge>
												</td>
											</tr>
										))}
									</tbody>
								</table>
							</div>
						)}
					</Section>

					<Section title="Courses" note="Paid course enrolments. This is separate from live-class attendance.">
						{data.courses.length === 0 ? (
							<EmptyState icon="ri-book-open-line" title="No courses" description="This instructor has not created any courses." />
						) : (
							<div className="table-responsive">
								<table className="table align-middle table-hover fs-14">
									<thead>
										<tr>
											<th scope="col">Course</th>
											<th scope="col">Subject / category</th>
											<th scope="col">Status</th>
											<th scope="col">Enrolments</th>
											<th scope="col">Created</th>
										</tr>
									</thead>
									<tbody>
										{data.courses.map((c) => (
											<tr key={c.id}>
												<td>{orNA(c.title)}</td>
												<td>{orNA(c.category)}</td>
												<td>
													<Badge tone={c.status === "approved" ? "success" : "warning"}>{c.status === "approved" ? "Approved" : "Pending approval"}</Badge>
												</td>
												<td>{c.enrolments}</td>
												<td>{formatDateOnly(c.createdAt)}</td>
											</tr>
										))}
									</tbody>
								</table>
							</div>
						)}
					</Section>

					<Section title="Students" note="Students who joined at least one completed class of this instructor. Each student is listed once.">
						{data.students.length === 0 ? (
							<EmptyState icon="ri-group-line" title="No attending students yet" description="No student has joined a completed class of this instructor." />
						) : (
							<div className="table-responsive">
								<table className="table align-middle table-hover fs-14">
									<thead>
										<tr>
											<th scope="col">Student</th>
											<th scope="col">Email</th>
											<th scope="col">Classes attended</th>
											<th scope="col">Last attended</th>
										</tr>
									</thead>
									<tbody>
										{data.students.map((s) => (
											<tr key={s.key}>
												<td>{orNA(s.name)}</td>
												<td>{orNA(s.email)}</td>
												<td>{s.sessionsAttended}</td>
												<td>{formatDateOnly(s.lastAttendedAt)}</td>
											</tr>
										))}
									</tbody>
								</table>
							</div>
						)}
					</Section>
				</>
			)}
		</AdminLayout>
	);
};

export default InstructorDetails;
