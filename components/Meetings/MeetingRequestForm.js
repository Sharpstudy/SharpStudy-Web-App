import React, { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import axios from "axios";
import { Field } from "@/components/ui/Form";
import { Button } from "@/components/ui";

export const PURPOSES = [
	{ value: "product_demo", label: "Product demo" },
	{ value: "course_inquiry", label: "Course inquiry" },
	{ value: "partnership", label: "Partnership" },
	{ value: "technical_support", label: "Technical support" },
	{ value: "other", label: "Other" },
];

const FALLBACK_ZONES = ["UTC", "America/Vancouver", "America/Edmonton", "America/Chicago", "America/Toronto", "America/New_York", "America/Sao_Paulo", "Europe/London", "Europe/Paris", "Europe/Berlin", "Africa/Lagos", "Africa/Johannesburg", "Asia/Dubai", "Asia/Kolkata", "Asia/Singapore", "Asia/Tokyo", "Australia/Sydney", "Pacific/Auckland"];
const todayLocal = () => {
	const d = new Date();
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const newKey = () => (typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `k${Date.now()}${Math.random().toString(36).slice(2)}`);

const EMPTY = { name: "", email: "", phone: "", organization: "", purpose: "", date: "", time: "", timeZone: "", message: "", website: "" };

// Client-side checks mirror the server rules (the server is the authority).
export function validate(v) {
	const e = {};
	if (v.name.trim().length < 2) e.name = "Please enter your full name.";
	if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.email.trim())) e.email = "Please enter a valid email address.";
	if (!/^[0-9+()\-.\s]{7,40}$/.test(v.phone.trim()) || v.phone.replace(/\D/g, "").length < 7) e.phone = "Please enter a valid phone number.";
	if (!PURPOSES.some((p) => p.value === v.purpose)) e.purpose = "Please choose a meeting purpose.";
	if (!v.date) e.date = "Please choose a date.";
	else if (v.date < todayLocal()) e.date = "That date is in the past.";
	if (!v.time) e.time = "Please choose a time.";
	if (!v.timeZone) e.timeZone = "Please choose a time zone.";
	return e;
}

const MeetingRequestForm = () => {
	const [v, setV] = useState(EMPTY);
	const [errors, setErrors] = useState({});
	const [state, setState] = useState("idle"); // idle | sending | done
	const [banner, setBanner] = useState("");
	const [result, setResult] = useState(null);
	const key = useRef(newKey()); // same key for retries of this form, so a double click is one request
	const sending = useRef(false);

	const zones = useMemo(() => {
		try {
			return Intl.supportedValuesOf("timeZone");
		} catch (e) {
			return FALLBACK_ZONES;
		}
	}, []);
	useEffect(() => {
		try {
			const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
			setV((s) => (s.timeZone ? s : { ...s, timeZone: tz || "UTC" }));
		} catch (e) {
			setV((s) => ({ ...s, timeZone: "UTC" }));
		}
	}, []);

	const set = (name) => (e) => {
		setV((s) => ({ ...s, [name]: e.target.value }));
		if (errors[name]) setErrors((x) => ({ ...x, [name]: undefined }));
	};

	const submit = async (e) => {
		e.preventDefault();
		if (sending.current) return; // ignore repeated clicks while a request is in flight
		setBanner("");
		const found = validate(v);
		if (Object.keys(found).length) {
			setErrors(found);
			setBanner("Please correct the highlighted fields.");
			return;
		}
		sending.current = true;
		setState("sending");
		try {
			const { data } = await axios.post("/api/meetings/request", { ...v, submissionKey: key.current }, { timeout: 20000 });
			setResult(data);
			setState("done");
		} catch (err) {
			const r = err.response;
			if (r && r.data && r.data.fields) setErrors(r.data.fields);
			setBanner(r ? (r.data && r.data.message) || "Something went wrong. Please try again." : "We could not reach the server. Check your connection and try again.");
			setState("idle");
		} finally {
			sending.current = false;
		}
	};

	if (state === "done" && result) {
		const statusHref = result.manageToken ? `/schedule-a-call/status/?ref=${encodeURIComponent(result.reference)}&token=${encodeURIComponent(result.manageToken)}` : null;
		return (
			<div className="ss-card ss-meeting__done" role="status">
				<span className="ss-icon-tile ss-icon-tile--lg ss-icon-tile--accent" aria-hidden="true">
					<i className="ri-calendar-check-line"></i>
				</span>
				<h2>Request received</h2>
				<p>
					Your reference ID is <strong className="ss-meeting__ref">{result.reference}</strong>.
				</p>
				<p>
					<strong>Your meeting is not confirmed yet.</strong> Our team will review your request and email you at <strong>{v.email.trim()}</strong> once it has been approved, declined, or a different time is proposed.
				</p>
				{statusHref && (
					<p>
						<Link href={statusHref}>
							<a className="ss-btn ss-btn--secondary">View or cancel this request</a>
						</Link>
					</p>
				)}
				<p className="ss-muted">Keep your reference ID. If you do not hear from us, quote it when you contact us.</p>
			</div>
		);
	}

	const sendingNow = state === "sending";
	return (
		<form className="ss-card ss-meeting__form" onSubmit={submit} noValidate aria-busy={sendingNow}>
			{banner && (
				<p className="ss-meeting__banner" role="alert">
					{banner}
				</p>
			)}
			<div className="ss-meeting__grid">
				<Field label="Full name *" name="name" autoComplete="name" value={v.name} onChange={set("name")} error={errors.name} maxLength={120} />
				<Field label="Email address *" name="email" type="email" autoComplete="email" value={v.email} onChange={set("email")} error={errors.email} maxLength={200} />
				<Field label="Phone number *" name="phone" type="tel" autoComplete="tel" value={v.phone} onChange={set("phone")} error={errors.phone} maxLength={40} />
				<Field label="Company or organization" name="organization" autoComplete="organization" value={v.organization} onChange={set("organization")} error={errors.organization} maxLength={160} />
				<Field label="Meeting purpose *" error={errors.purpose} className="ss-meeting__wide">
					<select name="purpose" className={`form-select${errors.purpose ? " is-invalid" : ""}`} value={v.purpose} onChange={set("purpose")}>
						<option value="">Select a purpose</option>
						{PURPOSES.map((p) => (
							<option key={p.value} value={p.value}>
								{p.label}
							</option>
						))}
					</select>
				</Field>
				<Field label="Preferred date *" name="date" type="date" min={todayLocal()} value={v.date} onChange={set("date")} error={errors.date} />
				<Field label="Preferred time *" name="time" type="time" value={v.time} onChange={set("time")} error={errors.time} />
				<Field label="Time zone *" error={errors.timeZone} className="ss-meeting__wide" hint="The date and time above are in this time zone.">
					<select name="timeZone" className={`form-select${errors.timeZone ? " is-invalid" : ""}`} value={v.timeZone} onChange={set("timeZone")}>
						{!zones.includes(v.timeZone) && v.timeZone && <option value={v.timeZone}>{v.timeZone}</option>}
						{zones.map((z) => (
							<option key={z} value={z}>
								{z.replace(/_/g, " ")}
							</option>
						))}
					</select>
				</Field>
				<Field label="Additional message" error={errors.message} className="ss-meeting__wide">
					<textarea name="message" className="form-control" rows={4} maxLength={2000} value={v.message} onChange={set("message")} />
				</Field>
			</div>
			{/* Honeypot: invisible to people, tempting to bots. */}
			<div className="ss-meeting__hp" aria-hidden="true">
				<label>
					Website
					<input type="text" name="website" tabIndex={-1} autoComplete="off" value={v.website} onChange={set("website")} />
				</label>
			</div>
			<p className="ss-muted ss-meeting__note">
				Submitting this form sends a request. Your meeting is <strong>not confirmed</strong> until our team approves it and emails you.
			</p>
			<Button type="submit" size="lg" disabled={sendingNow} icon={sendingNow ? "ri-loader-4-line" : "ri-calendar-line"}>
				{sendingNow ? "Sending…" : "Request a meeting"}
			</Button>
		</form>
	);
};

export default MeetingRequestForm;
