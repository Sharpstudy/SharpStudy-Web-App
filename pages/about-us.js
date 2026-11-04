import React from "react";
import PageBanner from "@/components/Common/PageBanner";
import Navbar from "@/components/_App/Navbar";
import Footer from "@/components/_App/Footer";
import { HowItWorks, Benefits, Audiences, FinalCta } from "@/components/Home/Sections";
import { Testimonials, Partners } from "@/components/Home/Trust";
import { HeroScene } from "@/components/ui/Illustration";
import { Button } from "@/components/ui";

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
				<section className="ss-section ss-section--tight" aria-labelledby="about-intro">
					<div className="ss-container ss-aboutintro">
						<div>
							<span className="ss-eyebrow">Who we are</span>
							<h2 id="about-intro">A project-based learning platform</h2>
							<p className="ss-lead">
								SharpStudy Learning Inc. is a project-based cognitive skills development platform that uses advanced pedagogy for practical and enhanced learning.
							</p>
							<p>Today that means project-based courses and live classes, a Mastery Ladder for practice, and a bookstore where readers of every age can find something to enjoy.</p>
							<div className="d-flex flex-wrap gap-2">
								<Button href="/books/" icon="ri-book-open-line">Explore Books</Button>
								<Button href="/courses/" variant="secondary" icon="ri-slideshow-2-line">Browse courses</Button>
								<Button href="/contact-us/" variant="ghost">Contact us</Button>
							</div>
						</div>
						<HeroScene className="ss-hero__scene" />
					</div>
				</section>
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
