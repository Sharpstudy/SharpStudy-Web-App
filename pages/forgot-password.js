import React from "react";
import Head from "next/head";
import Footer from "@/components/_App/Footer";
import Navbar from "@/components/_App/Navbar";
import ForgotPasswordForm from "@/components/Authentication/ForgotPasswordForm";

// Public. Step 1 of the password reset (the e-mailed link opens /reset-password).
const ForgotPassword = () => (
	<>
		<Head>
			<title>Forgot password — SharpStudy</title>
			<meta name="robots" content="noindex" />
		</Head>
		<Navbar />
		<main className="ss-auth">
			<div className="ss-container">
				<section className="ss-card ss-auth__card ss-auth__card--narrow" aria-labelledby="fp-title">
					<h1 id="fp-title">Forgot your password?</h1>
					<ForgotPasswordForm />
				</section>
			</div>
		</main>
		<Footer />
	</>
);

export default ForgotPassword;
