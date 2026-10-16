import React, { useCallback, useEffect, useState } from "react";
import Head from "next/head";
import { useRouter } from "next/router";
import axios from "axios";
import Navbar from "@/components/_App/Navbar";
import Footer from "@/components/_App/Footer";
import { PageHeader, Button } from "@/components/ui";

const LABEL = { pending: "Pending review", approved: "Confirmed", rejected: "Declined", reschedule_requested: "New time proposed", cancelled: "Cancelled" };
const fmt = (d, tz) => {
	try {
		return new Intl.DateTimeFormat("en-US", { timeZone: tz, dateStyle: "full", timeStyle: "short" }).format(new Date(d)) + ` (${tz})`;
	} catch (e) {
		return new Date(d).toLocaleString();
	}
};

// The visitor's private page: reachable only with the reference + secret from their e-mail / confirmation screen.
const Status = ({ user }) => {
	const { query, isReady } = useRouter();
	const [req, setReq] = useState(null);
	const [error, setError] = useState("");
	const [busy, setBusy] = useState(false);
	const ref = typeof query.ref === "string" ? query.ref : "";
	const token = typeof query.token === "string" ? query.token : "";

	const load = useCallback(async () => {
		try {
			const { data } = await axios.get("/api/meetings/manage", { params: { ref, token } });
			setReq(data.request);
			setError("");
		} catch (e) {
			setReq(null);
			setError((e.response && e.response.data && e.response.data.message) || "We could not load your request.");
		}
	}, [ref, token]);
	useEffect(() => {
		if (isReady) load();
	}, [isReady, load]);

	const act = async (action) => {
		if (busy) return;
		if (action === "cancel" && !window.confirm("Cancel this meeting request?")) return;
		setBusy(true);
		try {
			const { data } = await axios.post("/api/meetings/manage", { ref, token, action });
			setReq(data.request);
			setError("");
		} catch (e) {
			setError((e.response && e.response.data && e.response.data.message) || "That did not work. Please try again.");
		} finally {
			setBusy(false);
		}
	};

	return (
		<>
			<Head>
				<title>Your meeting request — SharpStudy</title>
				<meta name="robots" content="noindex" />
				{/* The link carries a private token: never leak it through the Referer header */}
				<meta name="referrer" content="no-referrer" />
			</Head>
			<Navbar user={user} />
			<main>
				<PageHeader title="Your meeting request" crumbs={[{ href: "/", label: "Home" }, { href: "/schedule-a-call/", label: "Schedule a call" }, { label: "Status" }]} />
				<div className="ss-container ss-meeting">
					{error && (
						<p className="ss-meeting__banner" role="alert">
							{error}
						</p>
					)}
					{req && (
						<div className="ss-card ss-meeting__done">
							<p className="ss-muted">Reference</p>
							<h2 className="ss-meeting__ref">{req.reference}</h2>
							<p>
								<span className={`ss-badge ss-meeting__status ss-meeting__status--${req.status}`}>{LABEL[req.status]}</span>
							</p>
							<p>You asked for: {fmt(req.requestedAt, req.timeZone)}</p>
							{req.status === "approved" && (
								<>
									<p>
										<strong>Confirmed for {fmt(req.confirmedStart, req.timeZone)}</strong> ({req.durationMinutes} minutes)
									</p>
									{req.meetingUrl && (
										<p>
											<a className="ss-btn" href={req.meetingUrl} target="_blank" rel="noopener noreferrer">
												Join the meeting
											</a>
										</p>
									)}
								</>
							)}
							{req.status === "reschedule_requested" && req.proposedStart && (
								<>
									<p>
										We propose <strong>{fmt(req.proposedStart, req.timeZone)}</strong> instead.
									</p>
									<p>
										<Button onClick={() => act("accept")} disabled={busy}>
											Accept this time
										</Button>
									</p>
								</>
							)}
							{req.status === "pending" && <p>Your meeting is not confirmed yet. We will email you after we have reviewed it.</p>}
							{["pending", "approved", "reschedule_requested"].includes(req.status) && (
								<Button variant="secondary" onClick={() => act("cancel")} disabled={busy}>
									Cancel request
								</Button>
							)}
						</div>
					)}
				</div>
			</main>
			<Footer />
		</>
	);
};

export default Status;
