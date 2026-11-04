import isEmail from "validator/lib/isEmail";
import { contactFormEmail } from "email-templates/contact-form-email";
import { rateLimit } from "@/lib/mastery-server/http";

// Public contact form. It e-mails the site owner, so it is limited per client
// address, validated, and the text is escaped (the e-mail template places it in HTML).
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const oneLine = (s, max) => String(s || "").replace(/[\r\n]+/g, " ").trim().slice(0, max);

export default async function handler(req, res) {
	if (req.method !== "POST") {
		return res.status(405).json({ message: `Method ${req.method} not allowed` });
	}
	if (!rateLimit(req, res, "contact", { windowMs: 60 * 60 * 1000, max: 5 })) return;
	const body = req.body || {};
	const name = oneLine(body.name, 100);
	const email = oneLine(body.email, 200);
	const phone = oneLine(body.phone, 40);
	const subject = oneLine(body.subject, 150);
	const message = String(body.message || "").trim().slice(0, 5000);
	if (!name || !subject || !message || !isEmail(email)) {
		return res.status(422).json({ message: "Please fill in your name, a valid email, a subject and a message." });
	}
	try {
		contactFormEmail(esc(name), esc(email), esc(phone), esc(subject), esc(message));
		res.status(200).json({
			message: "Email sent successfully.",
		});
	} catch (e) {
		res.status(400).json({
			error_code: "contact",
			message: "We could not send your message right now.",
		});
	}
}
