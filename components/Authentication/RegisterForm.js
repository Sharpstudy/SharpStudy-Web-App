import React from "react";
import axios from "axios";
import toast from "react-hot-toast";
import { handleLogin } from "@/utils/auth";
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

	const handleSubmit = async (e) => {
		e.preventDefault();
		try {
			setLoading(true);
			const url = `${baseUrl}/api/users/signup`;
			// `next` (same-site only, re-validated on the server) rides along so the e-mail link can return here.
			const payload = { ...user, next: router.query.next };
			const response = await axios.post(url, payload);
			handleLogin(response.data.edmy_users_token, router, asParent ? "/family/" : "/");
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
			let {
				response: {
					data: { message },
				},
			} = err;
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
					placeholder="Create a password"
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
	);
};

export default RegisterForm;
