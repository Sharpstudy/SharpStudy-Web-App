import React from "react";
import PageBanner from "@/components/Common/PageBanner";
import Navbar from "@/components/_App/Navbar";
import Footer from "@/components/_App/Footer";
import { HowItWorks, Benefits, Audiences, FinalCta } from "@/components/Home/Sections";
import { Testimonials, Partners } from "@/components/Home/Trust";

// The previous hero ("We Are Edmy! ... millions of students on Edmy") was
// leftover theme copy naming another brand; it is replaced by SharpStudy's
// own mission copy (from the former homepage Transform section).
const AboutUs = ({ user }) => {
	return (
		<>
			<Navbar user={user} />
			<main>
				<PageBanner
					pageTitle="About Us"
					homePageUrl="/"
					homePageText="Home"
					activePageText="About SharpStudy"
					description="Making the world future-ready by imparting critical cognitive, technical and business skills to the next generation of leaders."
				/>
				<Benefits />
				<HowItWorks />
				<Testimonials />
				<Partners />
				<Audiences />
				<FinalCta user={user} />
			</main>
			<Footer />
		</>
	);
};

export default AboutUs;
