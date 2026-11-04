import React, { useState } from "react";
import Link from "next/link";
import Footer from "@/components/_App/Footer";
import Navbar from "@/components/_App/Navbar";
import LoginForm from "@/components/Authentication/LoginForm";
import RegisterForm from "@/components/Authentication/RegisterForm";
import { AuthArt } from "@/components/ui/Illustration";
import ParentAuth from "@/components/Family/ParentAuth";
import { useRouter } from "next/router";

const points = [
	{ icon: "ri-book-open-line", text: "Books for every age, read right in your dashboard" },
	{ icon: "ri-lightbulb-flash-line", text: "Project-based courses and workshops" },
	{ icon: "ri-play-circle-line", text: "Video lessons, resources, quizzes and live classes" },
	{ icon: "ri-line-chart-line", text: "Track your progress and earn certificates" },
];

const APPLY = {
	instructor: {
		title: "Apply to teach on SharpStudy",
		register: "Step 1 of 2: create your account. Step 2: complete the instructor application.",
		login: "Log in to continue your instructor application.",
		note: "Instructor access is granted only after an administrator approves your application. Until then your account works as a student account.",
	},
	telecaller: {
		title: "Apply as a SharpStudy telecaller",
		register: "Step 1 of 2: create your account. Step 2: complete the telecaller application.",
		login: "Log in to continue your telecaller application.",
		note: "Telecaller access is granted only after an administrator approves your application. Until then your account has no telecaller access.",
	},
};

const tabs = [
	{ id: "register", label: "Create account" },
	{ id: "login", label: "Log in" },
];

const Auth = () => {
	const [register, setRegister] = useState("register");
	const { query } = useRouter();

	const onKeyDown = (e) => {
		if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
		const next = register === "register" ? "login" : "register";
		setRegister(next);
		document.getElementById(`tab-${next}`)?.focus();
	};

	// /auth?for=family: the parent sign-in in the family design. Same LoginForm / RegisterForm underneath.
	if (query.for === "family") return <ParentAuth />;

	// /auth?intent=instructor|telecaller: arrived from "Become an Instructor" / "Become a Telecaller". Display only: the
	// account is created as an ordinary account (the server never reads a role from the request) and the application
	// it leads to is reviewed by an admin before any instructor or telecaller access exists.
	const applying = Object.prototype.hasOwnProperty.call(APPLY, query.intent) ? APPLY[query.intent] : null;

	return (
		<>
			<Navbar />
			<main className="ss-auth">
				<div className="ss-container ss-auth__grid">
					<aside className="ss-auth__aside">
						<h2>Read, learn and grow.</h2>
						<p>Join SharpStudy to read books and learn at your own pace, on any device.</p>
						<ul>
							{points.map((p) => (
								<li key={p.text}>
									<span className="ss-icon-tile">
										<i className={p.icon}></i>
									</span>
									{p.text}
								</li>
							))}
						</ul>
						<AuthArt className="ss-auth__art" />
					</aside>

					<section className="ss-card ss-auth__card" aria-labelledby="auth-title">
						<h1 id="auth-title">
							{applying
								? applying.title
								: register === "register" ? "Create your account" : "Welcome back"}
						</h1>
						<p className="ss-muted">
							{applying
								? register === "register"
									? applying.register
									: applying.login
								: register === "register"
									? "It only takes a minute to get started."
									: "Log in to continue learning."}
						</p>
						{applying && (
							<div className="ss-alert" role="note">
								{applying.note}
							</div>
						)}

						<nav className="ss-audience" aria-label="Who is this account for?">
							<Link href={`/auth/?for=family&mode=${register}`}>
								<a className="ss-audience__parent">
									<span className="ss-audience__icon" aria-hidden="true"><i className="ri-parent-line"></i></span>
									<span>
										<strong>For Parents &amp; Families</strong>
										<small>Link your child and follow their progress</small>
									</span>
									<i className="ri-arrow-right-s-line" aria-hidden="true"></i>
								</a>
							</Link>
							<span className="ss-audience__student" aria-current="true">
								<strong>For Students &amp; Instructors</strong>
								<small>You&apos;re here</small>
							</span>
						</nav>

						<div className="ss-segmented" role="tablist" aria-label="Account">
							{tabs.map((t) => (
								<button
									key={t.id}
									id={`tab-${t.id}`}
									type="button"
									role="tab"
									aria-selected={register === t.id}
									aria-controls="auth-panel"
									tabIndex={register === t.id ? 0 : -1}
									onClick={() => setRegister(t.id)}
									onKeyDown={onKeyDown}
								>
									{t.label}
								</button>
							))}
						</div>

						<div id="auth-panel" role="tabpanel" aria-labelledby={`tab-${register}`}>
							{register === "register" ? <RegisterForm /> : <LoginForm />}
						</div>

						<p className="ss-auth__terms">
							By continuing you agree to our{" "}
							<Link href="/terms-conditions/">
								<a>Terms</a>
							</Link>{" "}
							and{" "}
							<Link href="/privacy-policy/">
								<a>Privacy Policy</a>
							</Link>
							.
						</p>
					</section>
				</div>
			</main>
			<Footer />
		</>
	);
};

export default Auth;
