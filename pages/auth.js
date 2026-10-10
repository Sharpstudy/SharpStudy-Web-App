import React, { useState } from "react";
import Link from "next/link";
import Footer from "@/components/_App/Footer";
import Navbar from "@/components/_App/Navbar";
import LoginForm from "@/components/Authentication/LoginForm";
import RegisterForm from "@/components/Authentication/RegisterForm";

const points = [
	{ icon: "ri-lightbulb-flash-line", text: "Project-based courses and workshops" },
	{ icon: "ri-play-circle-line", text: "Video lessons, resources, quizzes and live classes" },
	{ icon: "ri-line-chart-line", text: "Track your progress and earn certificates" },
];

const tabs = [
	{ id: "register", label: "Create account" },
	{ id: "login", label: "Log in" },
];

const Auth = () => {
	const [register, setRegister] = useState("register");

	const onKeyDown = (e) => {
		if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
		const next = register === "register" ? "login" : "register";
		setRegister(next);
		document.getElementById(`tab-${next}`)?.focus();
	};

	return (
		<>
			<Navbar />
			<main className="ss-auth">
				<div className="ss-container ss-auth__grid">
					<aside className="ss-auth__aside">
						<h2>Learn skills that last.</h2>
						<p>Join SharpStudy to start learning at your own pace, on any device.</p>
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
						{/* eslint-disable-next-line @next/next/no-img-element */}
						<img src="/images/register-img.png" alt="" className="ss-auth__art" />
					</aside>

					<section className="ss-card ss-auth__card" aria-labelledby="auth-title">
						<h1 id="auth-title">
							{register === "register" ? "Create your account" : "Welcome back"}
						</h1>
						<p className="ss-muted">
							{register === "register"
								? "It only takes a minute to get started."
								: "Log in to continue learning."}
						</p>

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
