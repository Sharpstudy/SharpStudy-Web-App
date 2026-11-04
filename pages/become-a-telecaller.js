import React from "react";
import Head from "next/head";
import PageBanner from "@/components/Common/PageBanner";
import Navbar from "@/components/_App/Navbar";
import Footer from "@/components/_App/Footer";
import TelecallerApplicationForm from "@/components/BecomeATelecaller/TelecallerApplicationForm";

// Requires sign-in (pages/_app.js). Submitting creates a PENDING application; only an admin's approval in
// Admin > Telecallers > Applications creates an active telecaller profile. The same page is the status page.
const becomeTelecaller = ({ user }) => {
	return (
		<>
			<Head>
				<title>Become a Telecaller — SharpStudy</title>
			</Head>
			<Navbar user={user} />
			<PageBanner pageTitle="Become a Telecaller" homePageUrl="/" homePageText="Home" activePageText="Become a Telecaller" />
			<div className="ia-page">
				<div className="container">
					<TelecallerApplicationForm />
				</div>
			</div>
			<Footer />
		</>
	);
};

export default becomeTelecaller;
