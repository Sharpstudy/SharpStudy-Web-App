import React from "react";
import PageBanner from "@/components/Common/PageBanner";
import Navbar from "@/components/_App/Navbar";
import Footer from "@/components/_App/Footer";
import ContactInfo from "@/components/ContactUs/ContactInfo";
import ContactForm from "@/components/ContactUs/ContactForm";

const ContactUs = ({ user }) => {
	return (
		<>
			<Navbar user={user} />
			<main>
				<PageBanner
					pageTitle="Contact Us"
					homePageUrl="/"
					homePageText="Home"
					activePageText="Contact us"
					description="Questions about courses, workshops or SharpStudy for business? We'd love to hear from you."
				/>
				<div className="ss-container ss-container--wide ss-contact">
					<ContactInfo />
					<div className="ss-card ss-contact__form">
						<ContactForm />
					</div>
				</div>
			</main>

			<Footer />
		</>
	);
};

export default ContactUs;
