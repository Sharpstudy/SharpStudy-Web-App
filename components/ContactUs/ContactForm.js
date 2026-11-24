import React, { useRef, useState } from "react";
import axios from "axios";
import Link from "next/link";
import baseUrl from "@/utils/baseUrl";

const INITIAL_STATE = { name: "", email: "", phone: "", subject: "", message: "" };
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Same endpoint and payload as before (POST /api/contact). The success message shown is exactly what the
// server returned; nothing is claimed unless the request succeeded.
const ContactForm = () => {
	const [contact, setContact] = useState(INITIAL_STATE);
	const [errors, setErrors] = useState({});
	const [status, setStatus] = useState(null); // { ok: boolean, text: string }
	const [loading, setLoading] = useState(false);
	const statusRef = useRef(null);

	const handleChange = (e) => {
		const { name, value } = e.target;
		setContact((prev) => ({ ...prev, [name]: value }));
		if (errors[name]) setErrors((prev) => ({ ...prev, [name]: undefined }));
	};

	const validate = () => {
		const e = {};
		if (!contact.name.trim()) e.name = "Please tell us your name.";
		if (!EMAIL_RE.test(contact.email.trim())) e.email = "Enter a valid email address so we can reply.";
		if (!contact.subject.trim()) e.subject = "Add a short subject.";
		if (!contact.message.trim()) e.message = "Write your message.";
		return e;
	};

	const handleSubmit = async (e) => {
		e.preventDefault();
		setStatus(null);
		const found = validate();
		setErrors(found);
		if (Object.keys(found).length) {
			const first = Object.keys(found)[0];
			const el = document.getElementById(`contact-${first}`);
			if (el) el.focus();
			return;
		}
		setLoading(true);
		try {
			const response = await axios.post(`${baseUrl}/api/contact`, { ...contact });
			setStatus({ ok: true, text: (response.data && response.data.message) || "Your message was sent." });
			setContact(INITIAL_STATE);
		} catch (err) {
			const server = err && err.response && err.response.data && err.response.data.message;
			const text = server || (err && err.response ? "We could not send your message right now. Please try again." : "We could not reach the server. Check your connection and try again. Your message has not been sent.");
			setStatus({ ok: false, text });
		} finally {
			setLoading(false);
			setTimeout(() => statusRef.current && statusRef.current.focus(), 0);
		}
	};

	const field = (name, label, props = {}) => (
		<div className="ss-cfield">
			<label htmlFor={`contact-${name}`}>{label}</label>
			<input
				id={`contact-${name}`}
				className={`form-control${errors[name] ? " is-invalid" : ""}`}
				name={name}
				value={contact[name]}
				onChange={handleChange}
				aria-invalid={errors[name] ? true : undefined}
				aria-describedby={errors[name] ? `contact-${name}-err` : undefined}
				{...props}
			/>
			{errors[name] && (
				<p id={`contact-${name}-err`} className="ss-field-error">
					{errors[name]}
				</p>
			)}
		</div>
	);

	return (
		<div className="contact-area">
			<h2 className="ss-contact__title">Send us a message</h2>
			<div ref={statusRef} tabIndex={-1} role="status" aria-live="polite">
				{status && <p className={`ss-formstatus ss-formstatus--${status.ok ? "ok" : "err"}`}>{status.text}</p>}
			</div>
			<form id="contactForm" onSubmit={handleSubmit} noValidate>
				<div className="ss-form-row">
					{field("name", "Your full name", { type: "text", autoComplete: "name", maxLength: 100 })}
					{field("email", "Your email", { type: "email", autoComplete: "email", inputMode: "email", maxLength: 200 })}
				</div>
				<div className="ss-form-row">
					{field("phone", "Your phone (optional)", { type: "tel", autoComplete: "tel", maxLength: 40 })}
					{field("subject", "Subject", { type: "text", maxLength: 150 })}
				</div>
				<div className="ss-cfield">
					<label htmlFor="contact-message">Message</label>
					<textarea
						id="contact-message"
						className={`form-control${errors.message ? " is-invalid" : ""}`}
						name="message"
						rows="5"
						maxLength={5000}
						value={contact.message}
						onChange={handleChange}
						aria-invalid={errors.message ? true : undefined}
						aria-describedby={errors.message ? "contact-message-err" : undefined}
					/>
					{errors.message && (
						<p id="contact-message-err" className="ss-field-error">
							{errors.message}
						</p>
					)}
				</div>
				<div className="form-check mb-3">
					<input id="contact-agree" name="check" className="form-check-input" type="checkbox" />
					<label className="form-check-label" htmlFor="contact-agree">
						I agree to the{" "}
						<Link href="/terms-conditions">
							<a>Terms &amp; conditions</a>
						</Link>
					</label>
				</div>
				<button type="submit" className="ss-btn ss-btn--lg" disabled={loading} aria-busy={loading ? true : undefined}>
					{loading ? "Sending…" : "Send Message"}
				</button>
			</form>
		</div>
	);
};

export default ContactForm;
