import React from "react";
import axios from "axios";
import Link from "next/link";
import toast from "react-hot-toast";
import { handleLogin } from "@/utils/auth";
import baseUrl from "@/utils/baseUrl";
import { useRouter } from "next/router";
import Button from "../../utils/Button";
import { Field, PasswordInput } from "@/components/ui/Form";
import GoogleButton from "./GoogleButton";

const INITIAL_USER = {
	email: "",
	password: "",
};

// asParent: returning parents land on /family/ (their Progress page; a safe ?next= still wins).
const LoginForm = ({ asParent = false }) => {
	const [user, setUser] = React.useState(INITIAL_USER);
	const [disabled, setDisabled] = React.useState(true);
	const [loading, setLoading] = React.useState(false);
	const [error, setError] = React.useState("");
	const [unverified, setUnverified] = React.useState(false);
	const [resent, setResent] = React.useState(false);
	const router = useRouter();

	React.useEffect(() => {
		const isUser = Object.values(user).every((el) => Boolean(el));
		isUser ? setDisabled(false) : setDisabled(true);
	}, [user]);

	const handleChange = (e) => {
		const { name, value } = e.target;
		setUser((prevState) => ({ ...prevState, [name]: value }));
		setError("");
	};

	const handleSubmit = async (e) => {
		e.preventDefault();
		setError("");
		setUnverified(false);
		setResent(false);
		try {
			setLoading(true);
			const url = `${baseUrl}/api/users/signin`;
			const payload = { ...user };
			const response = await axios.post(url, payload);
			handleLogin(response.data.edmy_users_token, router, asParent ? "/family/" : "/");
			toast.success(response.data.message);
		} catch (err) {
			const data = err?.response?.data || {};
			setUnverified(data.code === "email_unverified");
			setError(data.message || "Could not sign in right now, please try again.");
		} finally {
			setLoading(false);
		}
	};

	const resend = async () => {
		try {
			await axios.post(`${baseUrl}/api/users/send-confirmation-email`, { email: user.email, next: router.query.next });
			setResent(true);
		} catch (err) {
			setError(err?.response?.data?.message || "Could not send the email right now.");
		}
	};

	return (
		<>
			<GoogleButton fallback={asParent ? "/family/" : "/"} />
			<form onSubmit={handleSubmit} noValidate>
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
						autoComplete="current-password"
						placeholder="Your password"
						value={user.password}
						onChange={handleChange}
					/>
				</Field>
				<p className="ss-auth__forgot">
					<Link href="/forgot-password/">
						<a>Forgot password?</a>
					</Link>
				</p>
				{error && (
					<div className="ss-alert ss-alert--danger" role="alert">
						<span>
						{error}
						{unverified && !resent && (
							<>
								{" "}
								<button type="button" className="ss-link-btn" onClick={resend}>
									Send the confirmation email again
								</button>
							</>
						)}
						{resent && <> We have sent it again. Please check your inbox.</>}
						</span>
					</div>
				)}
				<Button
					loading={loading}
					disabled={disabled || loading}
					btnText="Sign in"
					btnClass="ss-btn ss-btn--lg ss-btn--block"
				/>
			</form>
		</>
	);
};

export default LoginForm;
