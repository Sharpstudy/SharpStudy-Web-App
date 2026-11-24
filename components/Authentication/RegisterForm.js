import React from "react";
import axios from "axios";
import toast from "react-hot-toast";
import GoogleButton from "./GoogleButton";
import baseUrl from "@/utils/baseUrl";
import { useRouter } from "next/router";
import Button from "../../utils/Button";
import { Field, PasswordInput } from "@/components/ui/Form";

const INITIAL_USER = {
	first_name: "",
	last_name: "",
	email: "",
	password: "",
};

// asParent: the "For Parents & Families" registration. It is an ordinary account; the redirect only differs
// (/family/, the Progress page, which offers "Link my child" until a child is linked).
const RegisterForm = ({ asParent = false }) => {
	const [user, setUser] = React.useState(INITIAL_USER);
	const [disabled, setDisabled] = React.useState(true);
	const [loading, setLoading] = React.useState(false);
	const router = useRouter();

	React.useEffect(() => {
		const isUser = Object.values(user).every((el) => Boolean(el));
		isUser ? setDisabled(false) : setDisabled(true);
	}, [user]);

	const handleChange = (e) => {
		const { name, value } = e.target;
		setUser((prevState) => ({ ...prevState, [name]: value }));
	};

	const [sent, setSent] = React.useState(null); // the address the confirmation email went to
	const [resent, setResent] = React.useState(false);

	const handleSubmit = async (e) => {
		e.preventDefault();
		try {
			setLoading(true);
			const url = `${baseUrl}/api/users/signup`;
			// `next` (same-site only, re-validated on the server) rides along so the e-mail link can return here.
			const payload = { ...user, next: router.query.next };
			const response = await axios.post(url, payload);
			// No login token comes back: the account is usable once the e-mail address is confirmed.
			setSent(response.data.email || user.email);
		} catch (err) {
			toast.error(err?.response?.data?.message || "Could not create the account right now, please try again.");
		} finally {
			setLoading(false);
		}
	};

	const resend = async () => {
		try {
			await axios.post(`${baseUrl}/api/users/send-confirmation-email`, { email: sent, next: router.query.next });
			setResent(true);
		} catch (err) {
			toast.error(err?.response?.data?.message || "Could not send the email right now.");
		}
	};

	if (sent) {
		return (
			<div role="status" className="ss-verify">
				<h2>Check your email</h2>
				<p>We sent a confirmation link to <strong>{sent}</strong>. Open it to activate your account, then log in{router.query.next ? " to continue" : ""}.</p>
				<p className="ss-muted">Nothing in your inbox? Check spam, or</p>
				<button type="button" className="ss-btn ss-btn--secondary" onClick={resend} disabled={resent}>{resent ? "Sent again" : "Send the email again"}</button>
			</div>
		);
	}

	return (
		<>
		<GoogleButton fallback={asParent ? "/family/" : "/"} />
		<form onSubmit={handleSubmit}>
			<div className="ss-form-row">
				<Field
					label="First name"
					name="first_name"
					autoComplete="given-name"
					value={user.first_name}
					onChange={handleChange}
				/>
				<Field
					label="Last name"
					name="last_name"
					autoComplete="family-name"
					value={user.last_name}
					onChange={handleChange}
				/>
			</div>
			<Field
				label="Email"
				type="email"
				name="email"
				autoComplete="email"
				inputMode="email"
				placeholder="you@example.com"
				value={user.email}
				onChange={handleChange}
			/>
			<Field label="Password">
				<PasswordInput
					name="password"
					autoComplete="new-password"
					placeholder="At least 8 characters, with a letter and a number"
					value={user.password}
					onChange={handleChange}
				/>
			</Field>
			<Button
				loading={loading}
				disabled={disabled || loading}
				btnText={asParent ? "Create parent account" : "Create account"}
				btnClass="ss-btn ss-btn--lg ss-btn--block"
			/>
		</form>
		</>
	);
};

export default RegisterForm;
