import React from "react";
import Head from "next/head";
import Navbar from "@/components/_App/Navbar";
import Footer from "@/components/_App/Footer";
import StoryCards from "@/components/Sections/StoryCards";
import useTestimonials from "@/components/Sections/useTestimonials";
import { Button, EmptyState, PageHeader, SectionHeader } from "@/components/ui";
import DemoBand from "@/components/FreeDemo/DemoBand";

// Success stories = the admin-managed testimonials (existing /api/testimonials and /admin/testimonials). Nothing is written here: if no
// testimonial is published the page shows an empty state. Achievements, competition results and documented improvements have no data
// source yet, so none is shown (see docs/website-sections/README.md for what SharpStudy needs to provide).
const SuccessStories = ({ user }) => {
	const items = useTestimonials();
	return (
		<>
			<Head>
				<title>Success Stories | SharpStudy</title>
				<meta name="description" content="What learners and families say about learning with SharpStudy." />
			</Head>
			<Navbar user={user} />
			<PageHeader title="Success stories" description="Words from the SharpStudy community." crumbs={[{ href: "/", label: "Home" }, { label: "Success stories" }]} />
			<main id="stories-main">
				<section className="ss-section" aria-labelledby="stories-title">
					<div className="ss-container">
						<SectionHeader align="center" eyebrow="Testimonials" title={<span id="stories-title">What our learners say</span>} />
						{items === null ? (
							<p className="ss-muted" role="status" style={{ textAlign: "center" }}>
								Loading…
							</p>
						) : items.length === 0 ? (
							<EmptyState
								icon="ri-chat-heart-line"
								title="Stories are coming soon"
								description="We will share learner and parent stories here once the people involved have agreed to be featured."
								action={
									<Button href="/programs/" variant="secondary">
										Explore the programs
									</Button>
								}
							/>
						) : (
							<StoryCards items={items} />
						)}
					</div>
				</section>
				<DemoBand source="success_stories_cta" title="Want to see it for yourself?" text="Book a free demo class and meet SharpStudy." />
			</main>
			<Footer />
		</>
	);
};

export default SuccessStories;
