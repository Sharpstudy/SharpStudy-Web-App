import React, { useCallback, useEffect, useState } from "react";
import axios from "axios";
import Link from "next/link";

const STATE = {
	completed: { label: "Completed", tone: "" },
	cancelled: { label: "Cancelled", tone: "danger" },
	live: { label: "Live now", tone: "success" },
};

const ICON = {
	live_session_assigned: "ri-calendar-check-line",
	live_session_rescheduled: "ri-calendar-event-line",
	live_session_cancelled: "ri-calendar-event-line",
	live_session_reminder: "ri-alarm-line",
	student_removal_requested: "ri-user-unfollow-line",
	student_removal_approved: "ri-user-unfollow-line",
	student_removal_rejected: "ri-user-unfollow-line",
	student_link_removed: "ri-user-unfollow-line",
	telecaller_followup: "ri-customer-service-2-line",
};

// The action label. Live-session notifications keep their original wording; telecaller notifications link to the follow-up / application.
const linkLabel = (n) => (n.type === "telecaller_followup" ? "Open follow-up" : String(n.type).startsWith("telecaller_") ? "View application" : n.state === "completed" ? "View session" : "Open session");

// The signed-in user's own notifications (live-session assignments, changes, reminders).
// Renders nothing when there are none or the request fails; it must never get in the way of the page.
const NotificationList = ({ limit = 5 }) => {
	const [items, setItems] = useState(null);
	const [unread, setUnread] = useState(0);

	const load = useCallback(async () => {
		try {
			const r = await axios.get("/api/notifications");
			setItems(r.data.notifications);
			setUnread(r.data.unread);
		} catch (e) {
			setItems([]);
		}
	}, []);
	useEffect(() => {
		load();
	}, [load]);

	const markAll = async () => {
		try {
			const r = await axios.post("/api/notifications", {});
			setUnread(r.data.unread);
			setItems((list) => list.map((n) => ({ ...n, read: true })));
		} catch (e) {
			/* leave as is */
		}
	};

	if (!items || items.length === 0) return null;
	return (
		<section className="ss-card ss-notices" aria-label="Notifications">
			<div className="ss-notices__head">
				<h3 className="ss-session__h">Notifications {unread > 0 && <span className="ss-badge ss-badge--primary">{unread} new</span>}</h3>
				{unread > 0 && <button type="button" className="ss-btn ss-btn--ghost ss-btn--sm" onClick={markAll}>Mark all read</button>}
			</div>
			<ul className="ss-notices__list">
				{items.slice(0, limit).map((n) => (
					<li key={n.id} className={n.read ? "" : "is-unread"}>
						<i className={ICON[n.type] || "ri-notification-3-line"} aria-hidden="true"></i>
						<div>
							<strong>{n.title}</strong> {STATE[n.state] && <span className={`ss-badge ${STATE[n.state].tone ? `ss-badge--${STATE[n.state].tone}` : ""}`}>{STATE[n.state].label}</span>}
							<p>{n.body.split("\n").map((line, i) => <span key={i}>{line}<br /></span>)}</p>
							{n.link && n.type !== "live_session_cancelled" && n.state !== "cancelled" && n.state !== "missing" && <Link href={n.link}><a>{linkLabel(n)}</a></Link>}
						</div>
					</li>
				))}
			</ul>
		</section>
	);
};

export default NotificationList;
