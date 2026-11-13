import React, { useCallback, useEffect, useState } from "react";
import axios from "axios";
import Link from "next/link";
import { Button, EmptyState } from "@/components/ui";
import NotificationList from "@/components/Notifications/NotificationList";
import { errMessage, fmtWhen, Status, TYPE_LABEL } from "./format";

const Row = ({ s, busy, onBook, onRelease }) => {
	const past = s.status === "completed" || s.status === "cancelled";
	return (
		<li className="ss-card ss-session__row">
			<div>
				<strong>{s.title}</strong> <Status session={s} />
				<p className="ss-muted">{s.courseTitle} · {TYPE_LABEL[s.sessionType]} · {fmtWhen(s)}</p>
				{s.booked && s.enrollmentMode === "assigned" && s.status === "scheduled" && <p className="ss-muted">Assigned by your instructor.</p>}
				{!s.booked && s.sessionType === "group" && <p className="ss-muted">{s.full ? "No seats left" : `${s.seatsLeft} of ${s.capacity} seats left`}</p>}
				{past && s.booked && s.status === "completed" && s.myAttendance && <p className="ss-muted">You were {s.myAttendance.status}.</p>}
			</div>
			<div className="ss-session__actions">
				{s.booked ? (
					<>
						<Link href={`/learning/live/${s.id}/`}><a className="ss-btn ss-btn--sm">{s.canJoin ? "Join" : past ? "Details" : "View"}</a></Link>
						{s.status === "scheduled" && s.enrollmentMode !== "assigned" && new Date() < new Date(s.startAt) && (
							<Button variant="ghost" size="sm" disabled={busy} onClick={() => onRelease(s)}>Cancel booking</Button>
						)}
					</>
				) : (
					<Button size="sm" disabled={busy || s.full} onClick={() => onBook(s)}>
						{s.full ? "Full" : s.sessionType === "one_to_one" ? "Book this slot" : "Reserve a seat"}
					</Button>
				)}
			</div>
		</li>
	);
};

const Section = ({ title, items, ...rest }) =>
	items.length === 0 ? null : (
		<section aria-label={title}>
			<h3 className="ss-session__h">{title}</h3>
			<ul className="ss-session__list">{items.map((s) => <Row key={s.id} s={s} {...rest} />)}</ul>
		</section>
	);

const StudentSessions = () => {
	const [sessions, setSessions] = useState(null);
	const [error, setError] = useState(null);
	const [notice, setNotice] = useState(null);
	const [busy, setBusy] = useState(false);

	const load = useCallback(async () => {
		try {
			const r = await axios.get("/api/live-sessions");
			setSessions(r.data.sessions);
			setError(null);
		} catch (e) {
			setError(errMessage(e));
		}
	}, []);
	useEffect(() => {
		load();
	}, [load]);

	const run = async (fn) => {
		setBusy(true);
		setNotice(null);
		try {
			await fn();
		} catch (e) {
			setNotice(errMessage(e));
		} finally {
			setBusy(false);
			load();
		}
	};
	const onBook = (s) => run(() => axios.post(`/api/live-sessions/${s.id}/seat`));
	const onRelease = (s) => run(() => axios.delete(`/api/live-sessions/${s.id}/seat`));

	if (error) return <div className="ss-alert ss-alert--danger" role="alert">{error}</div>;
	if (!sessions) return <p className="ss-muted" role="status">Loading live sessions…</p>;
	if (sessions.length === 0) {
		return <EmptyState icon="ri-live-line" title="No live sessions yet" description="Sessions for courses you have purchased will appear here once your instructor schedules them." action={<Button href="/learning/my-courses/">My courses</Button>} />;
	}

	const mineLive = sessions.filter((s) => s.booked && s.status === "live");
	const mineUpcoming = sessions.filter((s) => s.booked && s.status === "scheduled");
	const open = sessions.filter((s) => !s.booked && s.status === "scheduled");
	const history = sessions.filter((s) => s.booked && (s.status === "completed" || s.status === "cancelled")).reverse();
	const shared = { busy, onBook, onRelease };

	return (
		<div className="ss-session">
			<NotificationList />
			{notice && <div className="ss-alert ss-alert--danger" role="alert">{notice}</div>}
			<Section title="Live now" items={mineLive} {...shared} />
			<Section title="My upcoming sessions" items={mineUpcoming} {...shared} />
			<Section title="Available to book" items={open} {...shared} />
			<Section title="History" items={history} {...shared} />
		</div>
	);
};

export default StudentSessions;
