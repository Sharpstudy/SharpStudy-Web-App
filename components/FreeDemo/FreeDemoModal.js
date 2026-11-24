import React, { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import axios from "axios";
import { Field } from "@/components/ui/Form";
import { Button } from "@/components/ui";
import PhoneInput from "./PhoneField";
import { checkPhone, DEFAULT_COUNTRY } from "@/lib/freeDemo/phone";
import { CLASS_MODES, GRADES, PROGRAM_OPTIONS, todayLocal, maxDateLocal, validateDemoForm, validProgram } from "@/lib/freeDemo/config";

const newKey = () => (typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `k${Date.now()}${Math.random().toString(36).slice(2)}`);

// The one Free Demo booking dialog (opened by every "Book Free Demo" button and by the automatic popup). Submits to the existing
// POST /api/meetings/request with kind "free_demo"; the server validates everything again. `initial` = { program, source, page }.
const FreeDemoModal = ({ initial, onClose, onSubmitted }) => {
	const [v, setV] = useState({ name: "", country: DEFAULT_COUNTRY, national: "", childName: "", childGrade: "", program: validProgram(initial.program), classMode: "", email: "", date: "", time: "", timeZone: "", message: "", website: "" });
	const [errors, setErrors] = useState({});
	const [state, setState] = useState("idle"); // idle | sending | done
	const [banner, setBanner] = useState("");
	const [result, setResult] = useState(null);
	const [sentPhone, setSentPhone] = useState("");
	const dirty = useRef(false);
	const sending = useRef(false);
	const key = useRef(newKey()); // one key per dialog, so a double click or a retry is still a single enquiry
	const panel = useRef(null);

	const zones = useMemo(() => {
		try {
			return Intl.supportedValuesOf("timeZone");
		} catch (e) {
			return ["UTC", "Asia/Kolkata", "America/Toronto", "America/Vancouver", "Europe/London", "Asia/Dubai", "Asia/Singapore", "Australia/Sydney"];
		}
	}, []);
	useEffect(() => {
		let tz = "UTC";
		try {
			tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
		} catch (e) {}
		setV((s) => (s.timeZone ? s : { ...s, timeZone: tz }));
	}, []);

	// Dialog behaviour: scroll lock, focus the first field, Escape closes, Tab stays inside.
	useEffect(() => {
		const prev = document.body.style.overflow;
		document.body.style.overflow = "hidden";
		const firstInput = panel.current && panel.current.querySelector("input[name=name]");
		if (firstInput) firstInput.focus();
		const onKey = (e) => {
			if (e.key === "Escape") onClose();
			else if (e.key === "Tab" && panel.current) {
				const f = [...panel.current.querySelectorAll("button, a[href], input, select, textarea")].filter((n) => !n.disabled && n.tabIndex !== -1 && n.offsetParent !== null);
				if (!f.length) return;
				const a = f[0];
				const z = f[f.length - 1];
				if (e.shiftKey && document.activeElement === a) {
					e.preventDefault();
					z.focus();
				} else if (!e.shiftKey && document.activeElement === z) {
					e.preventDefault();
					a.focus();
				}
			}
		};
		document.addEventListener("keydown", onKey);
		return () => {
			document.removeEventListener("keydown", onKey);
			document.body.style.overflow = prev;
		};
	}, [onClose]);

	const set = (name) => (e) => {
		dirty.current = true;
		setV((s) => ({ ...s, [name]: e.target.value }));
		if (errors[name]) setErrors((x) => ({ ...x, [name]: undefined }));
	};

	const submit = async (e) => {
		e.preventDefault();
		if (sending.current) return;
		setBanner("");
		const ph = checkPhone(v.national, v.country); // the number must be valid for the chosen country
		const found = validateDemoForm({ ...v, phone: ph.ok ? ph.e164 : "" });
		if (!ph.ok) found.phone = ph.message;
		if (Object.keys(found).length) {
			setErrors(found);
			setBanner("Please correct the highlighted fields.");
			return;
		}
		sending.current = true;
		setState("sending");
		try {
			const payload = {
				kind: "free_demo",
				name: v.name,
				phone: ph.e164, // international form, e.g. +919876543210
				email: v.email,
				childName: v.childName,
				childGrade: v.childGrade,
				program: v.program,
				classMode: v.classMode,
				date: v.date,
				time: v.time,
				timeZone: v.timeZone,
				message: v.message,
				source: initial.source,
				page: initial.page,
				website: v.website,
				submissionKey: key.current,
			};
			const { data } = await axios.post("/api/meetings/request", payload, { timeout: 20000 });
			setResult(data);
			setSentPhone(ph.international);
			setState("done");
			onSubmitted();
		} catch (err) {
			const r = err.response;
			if (r && r.data && r.data.fields) setErrors(r.data.fields);
			setBanner(r ? (r.data && r.data.message) || "Something went wrong. Please try again." : "We could not reach the server. Check your connection and try again.");
			setState("idle");
		} finally {
			sending.current = false;
		}
	};

	const sendingNow = state === "sending";
	const statusHref = result && result.manageToken ? `/schedule-a-call/status/?ref=${encodeURIComponent(result.reference)}&token=${encodeURIComponent(result.manageToken)}` : null;
	const wantsTime = !!(v.date || v.time);

	return (
		<div className="ss-demo" onMouseDown={(e) => e.target === e.currentTarget && !dirty.current && onClose()}>
			<div id="free-demo-dialog" className="ss-demo__panel" role="dialog" aria-modal="true" aria-labelledby="free-demo-title" ref={panel}>
				<button type="button" className="ss-demo__close" aria-label="Close" onClick={onClose}>
					<i className="ri-close-line" aria-hidden="true"></i>
				</button>
				{/* Left column on desktop, a short banner above the form on phones. Decorative; the illustration is a local file. */}
				<aside className="ss-demo__aside">
					<span className="ss-demo__deco ss-demo__cloud ss-demo__cloud--a" aria-hidden="true"></span>
					<span className="ss-demo__deco ss-demo__cloud ss-demo__cloud--b" aria-hidden="true"></span>
					<span className="ss-demo__deco ss-demo__star ss-demo__star--a" aria-hidden="true"></span>
					<span className="ss-demo__deco ss-demo__star ss-demo__star--b" aria-hidden="true"></span>
					<span className="ss-demo__deco ss-demo__star ss-demo__star--c" aria-hidden="true"></span>
					<span className="ss-demo__deco ss-demo__shape ss-demo__shape--a" aria-hidden="true"></span>
					<span className="ss-demo__deco ss-demo__shape ss-demo__shape--b" aria-hidden="true"></span>
					<p className="ss-demo__headline">Big Dreams Start With Little Steps!</p>
					<p className="ss-demo__sub">Give your child the opportunity to explore, learn and grow.</p>
					<img className="ss-demo__art" src="/images/freedemo/children-learning.svg" alt="Four smiling children learning together with an open book" width="540" height="400" />
				</aside>
				<div className="ss-demo__main">
					{state === "done" && result ? (
						<div className="ss-demo__done" role="status">
							<span className="ss-icon-tile ss-icon-tile--lg ss-icon-tile--accent" aria-hidden="true">
								<i className="ri-calendar-check-line"></i>
							</span>
							<h2 id="free-demo-title">{result.duplicate ? "We already have this request" : "Request received"}</h2>
							<p>
								Your reference ID is <strong className="ss-meeting__ref">{result.reference}</strong>.
							</p>
							<p>
								<strong>Your free demo is not confirmed yet.</strong> Our team will contact you on <strong>{sentPhone}</strong>
								{v.email.trim() ? (
									<>
										{" "}
										or at <strong>{v.email.trim()}</strong>
									</>
								) : null}{" "}
								to arrange it.
							</p>
							{statusHref && (
								<p>
									<Link href={statusHref}>
										<a className="ss-btn ss-btn--secondary ss-btn--sm" onClick={onClose}>
											View or cancel this request
										</a>
									</Link>
								</p>
							)}
							<Button onClick={onClose}>Done</Button>
						</div>
					) : (
						<form onSubmit={submit} noValidate aria-busy={sendingNow}>
							<h2 id="free-demo-title">Book Your Free Demo Class</h2>
							<p className="ss-demo__intro">Tell us about your child and we will arrange a friendly demo session. Fields marked * are required.</p>
							{banner && (
								<p className="ss-meeting__banner" role="alert">
									{banner}
								</p>
							)}
							<div className="ss-meeting__grid">
								<Field label="Parent or guardian name *" name="name" autoComplete="name" value={v.name} onChange={set("name")} error={errors.name} maxLength={120} />
								<Field label="Child's name *" name="childName" value={v.childName} onChange={set("childName")} error={errors.childName} maxLength={120} />
								<Field label="Parent phone number *" error={errors.phone} className="ss-meeting__wide">
									<PhoneInput
										country={v.country}
										national={v.national}
										invalid={!!errors.phone}
										onChange={(n) => {
											dirty.current = true;
											setV((x) => ({ ...x, country: n.country, national: n.national }));
											if (errors.phone) setErrors((x) => ({ ...x, phone: undefined }));
										}}
									/>
								</Field>
								<Field label="Student grade *" error={errors.childGrade}>
									<select name="childGrade" className={`form-select${errors.childGrade ? " is-invalid" : ""}`} value={v.childGrade} onChange={set("childGrade")}>
										<option value="">Select grade</option>
										{GRADES.map((g) => (
											<option key={g} value={g}>
												{g}
											</option>
										))}
									</select>
								</Field>
								<Field label="Class type" error={errors.classMode}>
									<select name="classMode" className="form-select" value={v.classMode} onChange={set("classMode")}>
										<option value="">No preference</option>
										{CLASS_MODES.map((m) => (
											<option key={m.value} value={m.value}>
												{m.label}
											</option>
										))}
									</select>
								</Field>
								<Field label="Interested program *" error={errors.program} className="ss-meeting__wide" hint="You can change this.">
									<select name="program" className={`form-select${errors.program ? " is-invalid" : ""}`} value={v.program} onChange={set("program")}>
										<option value="">Select a program</option>
										{PROGRAM_OPTIONS.map((p) => (
											<option key={p.value} value={p.value}>
												{p.label}
											</option>
										))}
									</select>
								</Field>
								<Field label="Parent email (optional)" className="ss-meeting__wide" name="email" type="email" autoComplete="email" value={v.email} onChange={set("email")} error={errors.email} maxLength={200} />
								<Field label="Preferred date (optional)" name="date" type="date" min={todayLocal()} max={maxDateLocal()} value={v.date} onChange={set("date")} error={errors.date} />
								<Field label="Preferred time (optional)" name="time" type="time" value={v.time} onChange={set("time")} error={errors.time} />
								{wantsTime && (
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
								)}
								<Field label="Additional message (optional)" error={errors.message} className="ss-meeting__wide">
									<textarea name="message" className="form-control" rows={3} maxLength={1500} value={v.message} onChange={set("message")} />
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
								This sends a request. Your demo is <strong>not confirmed</strong> until our team contacts you. If you leave the time blank, we will suggest one.
							</p>
							<div className="ss-demo__actions">
								<Button type="submit" size="lg" className="ss-demo__submit" disabled={sendingNow} icon={sendingNow ? "ri-loader-4-line" : "ri-calendar-line"}>
									{sendingNow ? "Sending…" : "Book Free Demo"}
								</Button>
							</div>
						</form>
					)}
				</div>
			</div>
		</div>
	);
};

export default FreeDemoModal;
