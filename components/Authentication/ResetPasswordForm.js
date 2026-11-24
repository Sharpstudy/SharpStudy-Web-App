import React from "react";
import axios from "axios";
import Link from "next/link";
import { useRouter } from "next/router";
import baseUrl from "@/utils/baseUrl";
import Button from "../../utils/Button";
import { Field, PasswordInput } from "@/components/ui/Form";

// Step 2: choose the new password. The token comes from the e-mailed link; it is removed from the address bar as soon as it is read
// so it does not stay in history, screenshots or referrers.
const ResetPasswordForm = () => {
	const router = useRouter();
	const [token, setToken] = React.useState(null);
	const [password, setPassword] = React.useState("");
	const [confirm, setConfirm] = React.useState("");
	const [loading, setLoading] = React.useState(false);
	const [errors, setErrors] = React.useState({});
	const [message, setMessage] = React.useState("");
	const [done, setDone] = React.useState(false);

	React.useEffect(() => {
		if (!router.isReady) return;
		const t = typeof router.query.token === "string" ? router.query.token : "";
		setToken(t);
		if (t) window.history.replaceState(null, "", window.location.pathname);
	}, [router.isReady, router.query.token]);

	const submit = async (e) => {
		e.preventDefault();
		const next = {};
		if (password.length < 8) next.password = "Password must be at least 8 characters long.";
		else if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) next.password = "Password must contain at least one letter and one number.";
		if (confirm !== password) next.confirm = "The two passwords do not match.";
		setErrors(next);
		setMessage("");
		if (Object.keys(next).length) return;
		try {
			setLoading(true);
			await axios.post(`${baseUrl}/api/users/reset-password`, { token, password, confirm });
			setDone(true);
		} catch (err) {
			const data = err?.response?.data || {};
			setErrors(data.fields || {});
			setMessage(data.fields ? "" : data.message || "Could not reset the password right now, please try again.");
			if (data.code === "invalid_token") setToken("");
		} finally {
			setLoading(false);
		}
	};

	if (token === null) return <p className="ss-muted" role="status">Loading…</p>;

	if (done) {
		return (
			<div role="status" className="ss-verify">
				<h2>Password changed</h2>
				<p>Your password has been changed and you were signed out of your other sessions. Log in with your new password.</p>
				<Link href="/auth/">
					<a className="ss-btn">Log in</a>
				</Link>
			</div>
		);
	}

	if (!token) {
		return (
			<div className="ss-verify" role="alert">
				<h2>This link can&apos;t be used</h2>
				<p>The reset link is missing, has expired or was already used. Request a new one.</p>
				<Link href="/forgot-password/">
					<a className="ss-btn">Request a new link</a>
				</Link>
			</div>
		);
	}

	return (
		<form onSubmit={submit} noValidate>
			<Field label="New password" error={errors.password} hint="At least 8 characters, with a letter and a number.">
				<PasswordInput name="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
			</Field>
			<Field label="Confirm new password" error={errors.confirm}>
				<PasswordInput name="confirm" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
			</Field>
			{message && <div className="ss-alert ss-alert--danger" role="alert">{message}</div>}
			<Button loading={loading} disabled={!password || !confirm || loading} btnText="Change password" btnClass="ss-btn ss-btn--lg ss-btn--block" />
		</form>
	);
};

export default ResetPasswordForm;
