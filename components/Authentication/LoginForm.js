import React from "react";
import axios from "axios";
import toast from "react-hot-toast";
import { handleLogin } from "@/utils/auth";
import baseUrl from "@/utils/baseUrl";
import { useRouter } from "next/router";
import Button from "../../utils/Button";
import { Field, PasswordInput } from "@/components/ui/Form";

const INITIAL_USER = {
	email: "",
	password: "",
};

const LoginForm = () => {
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

	const handleSubmit = async (e) => {
		e.preventDefault();
		try {
			setLoading(true);
			const url = `${baseUrl}/api/users/signin`;
			const payload = { ...user };
			const response = await axios.post(url, payload);
			handleLogin(response.data.edmy_users_token, router);
			toast.success(response.data.message, {
				style: {
					border: "1px solid #4BB543",
					padding: "16px",
					color: "#4BB543",
				},
				iconTheme: {
					primary: "#4BB543",
					secondary: "#FFFAEE",
				},
			});
		} catch (err) {
			const message =
					err?.response?.data?.message ||
					"Could not sign in right now, please try again.";
			toast.error(message, {
				style: {
					border: "1px solid #ff0033",
					padding: "16px",
					color: "#ff0033",
				},
				iconTheme: {
					primary: "#ff0033",
					secondary: "#FFFAEE",
				},
			});
		} finally {
			setLoading(false);
		}
	};

	return (
		<form onSubmit={handleSubmit}>
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
			<Button
				loading={loading}
				disabled={disabled || loading}
				btnText="Log in"
				btnClass="ss-btn ss-btn--lg ss-btn--block"
			/>
		</form>
	);
};

export default LoginForm;
