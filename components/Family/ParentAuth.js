// Parent sign-in / registration in the family design (reference: "Parent sign-in"). It wraps the EXISTING
// LoginForm and RegisterForm, so authentication, validation, tokens and redirects are exactly the same
// code as the rest of the site; only the surroundings differ. Shown at /auth?for=family.
import React, { useEffect, useState } from "react";
import { useRouter } from "next/router";
import Head from "next/head";
import Link from "next/link";
import LoginForm from "@/components/Authentication/LoginForm";
import RegisterForm from "@/components/Authentication/RegisterForm";
import { AppMark } from "./art";

const STEPS = ["Create your parent account or sign in", "Choose Link my child and enter the code from their Study page", "See their learning progress"];

const ParentAuth = () => {
	const router = useRouter();
	const [mode, setMode] = useState("login");
	// /auth?for=family&mode=register opens on "Create a parent account"
	useEffect(() => {
		if (router.isReady && router.query.mode === "register") setMode("register");
	}, [router.isReady, router.query.mode]);
	const login = mode === "login";
	return (
		<div className="fm-root fm-auth">
			<Head>
				<title>{login ? "Parent sign-in" : "Create a parent account"} · Sharp Study</title>
				<meta name="robots" content="noindex" />
			</Head>
			<aside className="fm-auth__panel">
				<div className="fm-auth__brand">
					<AppMark size={46} inverted />
					<span className="fm-auth__brandname">Sharp Study</span>
					<span className="fm-auth__chip">Learn Together</span>
				</div>
				<div className="fm-auth__pitch">
					<h2 className="fm-display fm-display--xl fm-display--light">Ten minutes. Real things. Together.</h2>
					<p>Link your child&apos;s account and follow their learning progress.</p>
					<ol>
						{STEPS.map((s, i) => (
							<li key={s}><span>{i + 1}</span>{s}</li>
						))}
					</ol>
				</div>
				<span className="fm-auth__sun" aria-hidden="true" />
			</aside>

			<main className="fm-auth__main" id="main">
				<div className="fm-auth__box">
					<div className="fm-auth__mobilebrand">
						<AppMark size={44} />
						<span><strong>Sharp Study</strong><small>Learn Together</small></span>
					</div>
					<h1 className="fm-h1 fm-auth__title">
						<span className="fm-m-only">{login ? "Welcome back." : "Create a parent account."}</span>
						<span className="fm-d-only">{login ? "Parent sign-in" : "Create a parent account"}</span>
					</h1>
					<p className="fm-lead fm-auth__lead">
						<span className="fm-m-only">{login ? "Sign in to start a 10-minute activity with your kids." : "It only takes a minute."}</span>
						<span className="fm-d-only">{login ? "Use your Sharp Study account." : "It only takes a minute."}</span>
					</p>
					{login ? <LoginForm asParent /> : <RegisterForm asParent />}
					<p className="fm-auth__switch">
						{login ? "New here? " : "Already have an account? "}
						<button type="button" className="fm-linkbtn fm-linkbtn--underline" onClick={() => setMode(login ? "register" : "login")}>
							{login ? "Create a parent account" : "Sign in"}
						</button>
					</p>
					<Link href="/auth/">
						<a className="fm-audience fm-audience--student">
							<strong>For Students &amp; Instructors</strong>
							<span>Sign in or register with a student or instructor account instead</span>
						</a>
					</Link>
					<p className="fm-auth__terms">
						By continuing you agree to our <Link href="/terms-conditions/"><a>Terms</a></Link> and <Link href="/privacy-policy/"><a>Privacy Policy</a></Link>.
					</p>
				</div>
			</main>
		</div>
	);
};

export default ParentAuth;
