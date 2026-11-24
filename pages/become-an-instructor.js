import React from "react";
import PageBanner from "@/components/Common/PageBanner";
import Navbar from "@/components/_App/Navbar";
import Footer from "@/components/_App/Footer";
import ApplicationForm from "@/components/BecomeAInstructor/ApplicationForm";

// Requires sign-in (pages/_app.js). Submitting creates a PENDING application; only an admin's
// approval in Admin > Instructors > Requests grants instructor access.
const becomeInstructor = ({ user }) => {
	return (
		<>
			<Navbar user={user} />
			<PageBanner pageTitle="Become an Instructor" homePageUrl="/" homePageText="Home" activePageText="Become an Instructor" />
			<div className="ia-page">
				<div className="container">
					<ApplicationForm user={user} />
				</div>
			</div>
			<Footer />
		</>
	);
};

export default becomeInstructor;
