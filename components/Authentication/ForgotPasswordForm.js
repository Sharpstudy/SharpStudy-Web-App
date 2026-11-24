import React from "react";
import axios from "axios";
import Link from "next/link";
import baseUrl from "@/utils/baseUrl";
import Button from "../../utils/Button";
import { Field } from "@/components/ui/Form";

// Step 1 of the password reset: ask for the registered address. The answer is the same whether or not an account exists.
const ForgotPasswordForm = () => {
	const [email, setEmail] = React.useState("");
	const [loading, setLoading] = React.useState(false);
	const [error, setError] = React.useState("");
	const [done, setDone] = React.useState(false);

	const submit = async (e) => {
		e.preventDefault();
		setError("");
		if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim())) return setError("Enter a valid email address.");
		try {
			setLoading(true);
			await axios.post(`${baseUrl}/api/users/forgot-password`, { email: email.trim() });
			setDone(true);
		} catch (err) {
			setError(err?.response?.data?.message || "Could not send the email right now, please try again.");
		} finally {
			setLoading(false);
		}
	};

	if (done) {
		return (
			<div role="status" className="ss-verify">
				<h2>Check your email</h2>
				<p>If an account exists for <strong>{email.trim()}</strong>, we have sent a link to reset the password. The link works once and expires in 1 hour.</p>
				<p className="ss-muted">Nothing arrived? Check spam, or wait a minute and try again.</p>
				<Link href="/auth/">
					<a className="ss-btn ss-btn--secondary">Back to log in</a>
				</Link>
			</div>
		);
	}

	return (
		<form onSubmit={submit} noValidate>
			<p className="ss-muted">Enter the email address of your account and we will send you a link to choose a new password.</p>
			<Field label="Email" type="email" name="email" autoComplete="email" inputMode="email" placeholder="you@example.com" value={email} onChange={(e) => { setEmail(e.target.value); setError(""); }} error={error} />
			<Button loading={loading} disabled={!email || loading} btnText="Send reset link" btnClass="ss-btn ss-btn--lg ss-btn--block" />
			<p className="ss-auth__terms">
				<Link href="/auth/">
					<a>Back to log in</a>
				</Link>
			</p>
		</form>
	);
};

export default ForgotPasswordForm;
