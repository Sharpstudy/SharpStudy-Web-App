import React from "react";
import Head from "next/head";
import Footer from "@/components/_App/Footer";
import Navbar from "@/components/_App/Navbar";
import ResetPasswordForm from "@/components/Authentication/ResetPasswordForm";

// Public. Opened from the e-mailed link (?token=...). The token is read once and removed from the address bar; `no-referrer` keeps it
// out of any request this page makes to another site.
const ResetPassword = () => (
	<>
		<Head>
			<title>Choose a new password — SharpStudy</title>
			<meta name="robots" content="noindex" />
			<meta name="referrer" content="no-referrer" />
		</Head>
		<Navbar />
		<main className="ss-auth">
			<div className="ss-container">
				<section className="ss-card ss-auth__card ss-auth__card--narrow" aria-labelledby="rp-title">
					<h1 id="rp-title">Choose a new password</h1>
					<ResetPasswordForm />
				</section>
			</div>
		</main>
		<Footer />
	</>
);

export default ResetPassword;
