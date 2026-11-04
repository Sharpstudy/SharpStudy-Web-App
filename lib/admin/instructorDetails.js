// Admin > Instructors > one instructor: profile, teaching statistics, session history, courses and students.
// Pure: the repo hands in rows that were ALREADY filtered by the selected instructor's id (lc_classes.instructor_id,
// courses.userId); nothing here is a global count. Tests build the same row shapes without a database.
//
// Tables behind each figure (all existing, no new schema):
//   profile        users (+ instructor_profiles.subjects, instructor_applications.phone as fallbacks)
//   sessions       lc_classes            instructor_id, start_at/end_at (scheduled), started_at/ended_at (actual), status
//   registered     lc_enrolments         one seat per student per session
//   attended       lc_attendance         auto-recorded when a student joins (present/late), editable by the instructor
//   courses        courses (userId) + categories; enrolment count = enrolments with status "paid"
//
// Status rules (mirror lib/live-sessions/service.js, but never write):
//   cancelled                         -> "cancelled"
//   stored completed + started_at     -> "completed"      (held)
//   stored completed, never started   -> "not_held"       (the end time passed with nobody starting it)
//   stored live, within its window    -> "live"
//   stored live/scheduled past end+grace: the service settles these lazily, so they are derived here the same way
//                                        (live -> completed, ended at the scheduled end; scheduled -> not_held)
//   stored scheduled, not yet due     -> "upcoming"
import { WINDOW } from "../live-sessions/service.js";
import { isAnonymized } from "./anonymized.js";

const ms = (d) => (d ? new Date(d).getTime() : NaN);
const iso = (d) => (d ? new Date(d).toISOString() : null);
const clean = (v) => {
	const s = String(v == null ? "" : v).trim();
	return s || null;
};
const ATTENDED = new Set(["present", "late"]);
export const SESSION_STATUSES = ["completed", "upcoming", "live", "cancelled", "not_held"];

// -> { status, endedAt } where endedAt is the recorded (or system-settled) end of a held session.
export function effectiveSession(s, now = new Date()) {
	if (s.status === "cancelled") return { status: "cancelled", startedAt: null, endedAt: null };
	const due = ms(s.end_at) + WINDOW.graceMs <= now.getTime();
	if (s.status === "completed") return { status: s.started_at ? "completed" : "not_held", startedAt: s.started_at || null, endedAt: s.ended_at || null };
	if (s.status === "live") return due ? { status: "completed", startedAt: s.started_at || null, endedAt: s.ended_at || s.end_at } : { status: "live", startedAt: s.started_at || null, endedAt: null };
	return due ? { status: "not_held", startedAt: null, endedAt: null } : { status: "upcoming", startedAt: null, endedAt: null };
}

// Seconds actually taught, or null when the records do not say (never the scheduled length).
export function actualSeconds(eff) {
	if (eff.status !== "completed" || !eff.startedAt || !eff.endedAt) return null;
	const d = (ms(eff.endedAt) - ms(eff.startedAt)) / 1000;
	return Number.isFinite(d) && d >= 0 ? Math.round(d) : null;
}

const studentUserId = (participantKey) => (String(participantKey || "").startsWith("u:") ? String(participantKey).slice(2) : null);

export function buildInstructorDetails({ user, profile, application, sessions, seats, attendance, courses, enrolmentCounts, courseTitles, studentUsers, now = new Date() }) {
	const anonymized = isAnonymized(user);
	const mine = new Set(sessions.map((s) => s.id));
	// Defence in depth: ignore any row that is not tied to one of THIS instructor's sessions.
	const seatsBy = new Map();
	for (const x of seats) if (mine.has(x.class_id)) (seatsBy.get(x.class_id) || seatsBy.set(x.class_id, []).get(x.class_id)).push(x);
	const attBy = new Map();
	for (const x of attendance) if (mine.has(x.class_id)) (attBy.get(x.class_id) || attBy.set(x.class_id, []).get(x.class_id)).push(x);

	const counts = { completed: 0, upcoming: 0, live: 0, cancelled: 0, not_held: 0 };
	let seconds = 0;
	let held = 0;
	let withRecord = 0;
	let lastConductedAt = null;
	const rates = [];
	const students = new Map(); // participant_key -> { sessions, lastAt }

	const sessionRows = sessions
		.map((s) => {
			const eff = effectiveSession(s, now);
			counts[eff.status] += 1;
			const seatRows = seatsBy.get(s.id) || [];
			const attRows = attBy.get(s.id) || [];
			const attendedRows = attRows.filter((a) => ATTENDED.has(a.status));
			const isHeld = eff.status === "completed";
			let durationSeconds = null;
			if (isHeld) {
				held += 1;
				durationSeconds = actualSeconds(eff);
				if (durationSeconds != null) {
					seconds += durationSeconds;
					withRecord += 1;
				}
				if (!lastConductedAt || ms(eff.startedAt) > ms(lastConductedAt)) lastConductedAt = eff.startedAt;
				for (const a of attendedRows) {
					const cur = students.get(a.participant_key) || { sessions: 0, lastAt: null, name: a.display_name };
					cur.sessions += 1;
					if (!cur.lastAt || ms(s.start_at) > ms(cur.lastAt)) cur.lastAt = s.start_at;
					students.set(a.participant_key, cur);
				}
				if (seatRows.length) {
					const seated = new Set(seatRows.map((x) => x.participant_key));
					rates.push(attendedRows.filter((a) => seated.has(a.participant_key)).length / seatRows.length);
				}
			}
			return {
				id: s.id,
				title: s.title,
				subject: s.subject,
				course: s.course_id ? courseTitles.get(s.course_id) || null : null,
				sessionType: s.session_type || "group",
				timeZone: s.time_zone,
				startAt: iso(s.start_at),
				endAt: iso(s.end_at),
				scheduledMinutes: Math.round((ms(s.end_at) - ms(s.start_at)) / 60000),
				// the length actually taught; null (shown as N/A) when it was not recorded or the class did not happen
				actualMinutes: durationSeconds == null ? null : Math.round(durationSeconds / 60),
				registered: seatRows.length,
				attended: isHeld ? attendedRows.length : null,
				status: eff.status,
			};
		})
		.sort((a, b) => ms(b.startAt) - ms(a.startAt));

	const studentList = [...students.entries()]
		.map(([key, v]) => {
			const uid = studentUserId(key);
			const u = uid ? studentUsers.get(uid) : null;
			const gone = u && isAnonymized(u);
			return {
				key,
				name: gone ? "Anonymized student" : u ? `${u.first_name || ""} ${u.last_name || ""}`.trim() || v.name : v.name,
				email: u && !gone ? u.email : null,
				sessionsAttended: v.sessions,
				lastAttendedAt: iso(v.lastAt),
			};
		})
		.sort((a, b) => b.sessionsAttended - a.sessionsAttended || String(a.name).localeCompare(String(b.name)));

	const own = (k) => clean(user[k]);
	return {
		profile: {
			id: user.id,
			name: `${user.first_name || ""} ${user.last_name || ""}`.trim(),
			email: user.email,
			role: user.role,
			status: user.status,
			anonymized,
			registeredAt: iso(user.created_at),
			phone: own("phone") || (!anonymized && application ? clean(application.phone) : null),
			subject: own("instructor_subject") || (!anonymized && profile ? clean(profile.subjects) : null),
			about: own("instructor_description") || own("bio"),
		},
		stats: {
			completedSessions: counts.completed,
			upcomingSessions: counts.upcoming,
			liveSessions: counts.live,
			cancelledSessions: counts.cancelled,
			notHeldSessions: counts.not_held,
			uniqueStudents: students.size,
			// null => N/A: no held session has a recorded start and end
			teachingHours: held === 0 ? 0 : withRecord === 0 ? null : Math.round((seconds / 3600) * 100) / 100,
			sessionsWithRecordedDuration: withRecord,
			heldSessionsWithoutRecordedDuration: held - withRecord,
			// null => N/A: no held session had booked students to measure against
			averageAttendance: rates.length ? Math.round((rates.reduce((a, b) => a + b, 0) / rates.length) * 1000) / 1000 : null,
			attendanceSessionsCounted: rates.length,
			courses: courses.length,
			lastConductedAt,
		},
		sessions: sessionRows,
		courses: courses
			.map((c) => ({
				id: c.id,
				title: c.title,
				category: c.category || null,
				status: c.approved ? "approved" : "pending",
				enrolments: enrolmentCounts.get(c.id) || 0,
				createdAt: iso(c.created_at),
			}))
			.sort((a, b) => ms(b.createdAt) - ms(a.createdAt)),
		students: studentList,
	};
}

// ---------------------------------------------------------------- loading (repo is injected)

export class DetailsError extends Error {
	constructor(status, message) {
		super(message);
		this.status = status;
	}
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// `id` is client-supplied: it is validated here, and the target must really hold the instructor role.
export async function loadInstructorDetails(repo, id, now = new Date()) {
	if (!UUID.test(String(id || ""))) throw new DetailsError(422, "Invalid instructor id");
	const user = await repo.getInstructor(id);
	if (!user) throw new DetailsError(404, "Instructor not found");

	const [profile, application, sessions, courses] = await Promise.all([repo.getProfile(id), repo.getApplicationPhone(id), repo.listSessions(id), repo.listCourses(id)]);
	const classIds = sessions.map((s) => s.id);
	const [seats, attendance, enrolmentCounts] = await Promise.all([repo.listSeats(classIds), repo.listAttendance(classIds), repo.enrolmentCounts(courses.map((c) => c.id))]);

	const studentIds = [...new Set(attendance.filter((a) => ATTENDED.has(a.status)).map((a) => studentUserId(a.participant_key)).filter(Boolean))];
	const ownCourse = new Set(courses.map((c) => c.id));
	const [studentUsers, extraTitles] = await Promise.all([repo.studentUsers(studentIds), repo.courseTitles([...new Set(sessions.map((s) => s.course_id).filter((c) => c && !ownCourse.has(c)))])]);
	const courseTitles = new Map([...courses.map((c) => [c.id, c.title]), ...extraTitles]);

	return buildInstructorDetails({ user, profile, application, sessions, seats, attendance, courses, enrolmentCounts, courseTitles, studentUsers, now });
}
