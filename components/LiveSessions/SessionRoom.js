import React, { useCallback, useEffect, useRef, useState } from "react";
import axios from "axios";
import Script from "next/script";
import LiveClassComponent from "@/components/Learning/LiveClassComponent";
import { Button } from "@/components/ui";
import { errMessage, fmtWhen, fmtDuration, Status, TYPE_LABEL } from "./format";

const POLL_MS = 15000;
const api = (id, path = "") => `/api/live-sessions/${encodeURIComponent(id)}${path}`;

// One scheduled session, for the instructor or a seat holder. The server decides
// everything: the Join button only asks, and the room name arrives in the
// response of POST /join (re-validated on every call), never from this page.
// The meeting itself is the existing LiveClassComponent (one Jitsi + Live Questions).
const SessionRoom = ({ sessionId, backHref, backLabel }) => {
	const [session, setSession] = useState(null);
	const [error, setError] = useState(null);
	const [notice, setNotice] = useState(null);
	const [busy, setBusy] = useState(false);
	const [room, setRoom] = useState(null); // { roomName, domain, displayName } once joined
	const joined = useRef(false);

	const load = useCallback(async () => {
		try {
			const r = await axios.get(api(sessionId), { timeout: 10000 });
			setSession(r.data.session);
			setError(null);
		} catch (e) {
			setError({ status: e.response && e.response.status, message: errMessage(e) });
		}
	}, [sessionId]);

	useEffect(() => {
		load();
		const t = setInterval(() => {
			if (!joined.current && !document.hidden) load();
		}, POLL_MS);
		return () => clearInterval(t);
	}, [load]);

	const leave = useCallback(() => {
		if (!joined.current) return;
		joined.current = false;
		setRoom(null);
		axios.post(api(sessionId, "/leave")).catch(() => {});
	}, [sessionId]);

	// Leaving the page closes our attendance stint.
	useEffect(() => leave, [leave]);

	const join = async () => {
		setBusy(true);
		setNotice(null);
		try {
			const r = await axios.post(api(sessionId, "/join"));
			joined.current = true;
			setRoom(r.data);
			load();
		} catch (e) {
			setNotice(errMessage(e));
			load();
		} finally {
			setBusy(false);
		}
	};

	const act = async (action, extra = {}) => {
		setBusy(true);
		setNotice(null);
		try {
			const r = await axios.post(api(sessionId), { action, ...extra });
			setSession(r.data.session);
			if (action === "end") leave();
			return true;
		} catch (e) {
			setNotice(errMessage(e));
			return false;
		} finally {
			setBusy(false);
		}
	};

	if (error && !session) {
		return (
			<div className="ss-card ss-alert ss-alert--danger" role="alert">
				<p>{error.status === 404 ? "This session was not found, or you do not have access to it." : error.message}</p>
				{backHref && <Button href={backHref} variant="ghost" size="sm">{backLabel || "Back"}</Button>}
			</div>
		);
	}
	if (!session) return <p className="ss-muted" role="status">Loading session…</p>;

	const instructor = session.role === "instructor";
	const canEnter = instructor ? session.windowOpen && (session.status === "scheduled" || session.status === "live") : session.canJoin;

	return (
		<div className="ss-session">
			<div className="ss-card ss-session__head">
				<div>
					<h2 className="ss-session__title">{session.title}</h2>
					<p className="ss-muted">
						{session.courseTitle && <>{session.courseTitle} · </>}
						{TYPE_LABEL[session.sessionType]} · {fmtWhen(session)}
					</p>
					{session.description && <p>{session.description}</p>}
				</div>
				<div className="ss-session__meta">
					<Status session={session} />
					<span className="ss-badge">{session.seatsTaken}/{session.capacity} {session.sessionType === "one_to_one" ? "booked" : "seats"}</span>
				</div>
			</div>

			{notice && <div className="ss-alert ss-alert--danger" role="alert">{notice}</div>}

			{room ? (
				<>
					<Script src={`https://${room.domain}/external_api.js`} strategy="afterInteractive" />
					<LiveClassComponent
						roomName={room.roomName}
						displayName={room.displayName}
						domain={room.domain}
						questionsKey={session.id}
						onMeetingEnd={leave}
					/>
					<div className="ss-session__actions">
						<Button variant="ghost" size="sm" onClick={leave}>Leave meeting</Button>
						{instructor && session.status === "live" && (
							<Button size="sm" disabled={busy} onClick={() => window.confirm("End this session for everyone?") && act("end")}>End session</Button>
						)}
					</div>
				</>
			) : (
				<JoinPanel session={session} instructor={instructor} canEnter={canEnter} busy={busy} onJoin={join} />
			)}

			{instructor && !room && <InstructorTools session={session} busy={busy} act={act} />}
			{instructor && <Roster session={session} />}
			{!instructor && session.status === "completed" && <MyAttendance session={session} />}
			{backHref && <p><Button href={backHref} variant="ghost" size="sm">{backLabel || "Back"}</Button></p>}
		</div>
	);
};

const JoinPanel = ({ session, instructor, canEnter, busy, onJoin }) => {
	let hint = null;
	if (session.status === "cancelled") hint = "This session was cancelled.";
	else if (session.status === "completed") hint = session.held ? "This session has finished." : "This session was not held.";
	else if (!canEnter) hint = `${instructor ? "You can start" : "You can join"} from ${new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(session.joinOpensAt))}.`;
	else if (!instructor && session.status === "scheduled") hint = "Your instructor has not started yet. You can enter and wait.";
	const done = session.status === "cancelled" || session.status === "completed";
	return (
		<div className="ss-card ss-session__join">
			{hint && <p className="ss-muted" role="status">{hint}</p>}
			{!done && (
				<Button disabled={!canEnter || busy} onClick={onJoin} icon="ri-vidicon-line">
					{busy ? "Connecting…" : instructor ? (session.status === "live" ? "Rejoin session" : "Start session") : "Join session"}
				</Button>
			)}
		</div>
	);
};

const pad = (n) => String(n).padStart(2, "0");
const InstructorTools = ({ session, busy, act }) => {
	const [open, setOpen] = useState(false);
	const start = new Date(session.startAt);
	const [f, setF] = useState({
		date: `${start.getFullYear()}-${pad(start.getMonth() + 1)}-${pad(start.getDate())}`,
		time: `${pad(start.getHours())}:${pad(start.getMinutes())}`,
		durationMin: Math.round((new Date(session.endAt) - start) / 60000),
		timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
	});
	if (session.status !== "scheduled") return null;
	return (
		<div className="ss-card ss-session__tools">
			<div className="ss-session__actions">
				<Button variant="ghost" size="sm" onClick={() => setOpen(!open)} aria-expanded={open}>Reschedule</Button>
				<Button variant="ghost" size="sm" disabled={busy} onClick={() => window.confirm("Cancel this session? Booked students will see it as cancelled.") && act("cancel")}>Cancel session</Button>
			</div>
			{open && (
				<form
					className="ss-session__form"
					onSubmit={async (e) => {
						e.preventDefault();
						if (await act("reschedule", f)) setOpen(false);
					}}
				>
					<Field label="Date" id="rs-date"><input id="rs-date" type="date" className="form-control" required value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
					<Field label="Start time" id="rs-time"><input id="rs-time" type="time" className="form-control" required value={f.time} onChange={(e) => setF({ ...f, time: e.target.value })} /></Field>
					<Field label="Duration (min)" id="rs-dur"><input id="rs-dur" type="number" min={15} max={240} className="form-control" required value={f.durationMin} onChange={(e) => setF({ ...f, durationMin: Number(e.target.value) })} /></Field>
					<Field label="Time zone" id="rs-tz"><input id="rs-tz" className="form-control" required value={f.timeZone} onChange={(e) => setF({ ...f, timeZone: e.target.value })} /></Field>
					<Button type="submit" size="sm" disabled={busy}>Save new time</Button>
				</form>
			)}
		</div>
	);
};

export const Field = ({ label, id, children }) => (
	<div>
		<label className="form-label" htmlFor={id}>{label}</label>
		{children}
	</div>
);

const Roster = ({ session }) => (
	<section className="ss-card" aria-label="Participants and attendance">
		<h3 className="ss-session__h">Participants {session.status === "cancelled" ? "" : `(${session.participants.length})`}</h3>
		{session.participants.length === 0 ? (
			<p className="ss-muted">{session.sessionType === "one_to_one" ? "Nobody has booked this slot yet." : "No students have taken a seat yet."}</p>
		) : (
			<div className="table-responsive">
				<table className="table align-middle fs-14">
					<caption className="visually-hidden">Participants and attendance</caption>
					<thead><tr><th scope="col">Student</th><th scope="col">Attendance</th><th scope="col">Time in class</th></tr></thead>
					<tbody>
						{session.participants.map((p) => (
							<tr key={p.userId}>
								<td>{p.name}</td>
								<td>{p.attendance ? p.attendance.status : <span className="ss-muted">Not joined</span>}</td>
								<td>{p.attendance ? fmtDuration(p.attendance.totalSeconds) : "—"}</td>
							</tr>
						))}
					</tbody>
				</table>
			</div>
		)}
	</section>
);

const MyAttendance = ({ session }) => (
	<section className="ss-card" aria-label="Your attendance">
		<h3 className="ss-session__h">Your attendance</h3>
		{session.myAttendance ? (
			<p>
				<strong style={{ textTransform: "capitalize" }}>{session.myAttendance.status}</strong>
				{session.myAttendance.totalSeconds > 0 && <> · {fmtDuration(session.myAttendance.totalSeconds)} in class</>}
			</p>
		) : (
			<p className="ss-muted">No attendance was recorded for you.</p>
		)}
	</section>
);

export default SessionRoom;
