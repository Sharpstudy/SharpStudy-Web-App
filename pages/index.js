import React from "react";
import Navbar from "@/components/_App/Navbar";
import Footer from "@/components/_App/Footer";
import CoursesList from "@/components/Courses/CoursesList";
import FaqList from "@/components/Common/FaqList";
import Hero from "@/components/Home/Hero";
import { Categories, HowItWorks, Benefits, Audiences, FinalCta } from "@/components/Home/Sections";
import { Testimonials, Partners } from "@/components/Home/Trust";
import { Button, EmptyState, SectionHeader } from "@/components/ui";
import HomeBooks from "@/components/Books/HomeBooks";
import { safeHomeSections } from "@/lib/books/pageActor";
import baseUrl from "@/utils/baseUrl";
import { landingRedirect } from "@/lib/auth/landing";

const Home = ({ courses, categories, books, user }) => {
	return (
		<>
			<Navbar user={user} />
			<main>
				<Hero />
				<HomeBooks sections={books} user={user} />

				<Categories categories={categories} />

				<section className="ss-section" aria-labelledby="popular-title">
					<div className="ss-container">
						<SectionHeader
							eyebrow="Courses"
							title={<span id="popular-title">Expand your career opportunities</span>}
							description="Hand-picked courses from our catalogue."
							action={
								<Button href="/courses/" variant="secondary" iconRight="ri-arrow-right-line">
									View all courses
								</Button>
							}
						/>
						<CoursesList
							courses={courses}
							user={user}
							empty={
								<EmptyState
									icon="ri-star-smile-line"
									title="Featured courses are coming soon"
									description="Our team hasn't featured any courses on the homepage yet. You can still explore everything in the catalogue."
									action={<Button href="/courses/">Explore the catalogue</Button>}
								/>
							}
						/>
					</div>
				</section>

				<HowItWorks />
				<Benefits />
				<Testimonials />
				<Partners />
				<Audiences />

				<section className="ss-section ss-section--tint" aria-labelledby="faq-title">
					<div className="ss-container ss-faq-wrap">
						<SectionHeader
							eyebrow="FAQ"
							title={<span id="faq-title">Questions, answered</span>}
							description="Everything you need to know before you start."
							action={
								<Button href="/faq/" variant="ghost" iconRight="ri-arrow-right-line">
									All FAQs
								</Button>
							}
						/>
						<FaqList limit={4} />
					</div>
				</section>

				<FinalCta user={user} />
			</main>
			<Footer />
		</>
	);
};

// This gets called on every request
export async function getServerSideProps({ req }) {
	// Signed-in students/instructors never see the marketing homepage.
	const redirect = await landingRedirect(req).catch(() => null);
	if (redirect) return { redirect };
	// Fetch data from external API
	const res = await fetch(`${baseUrl}/api/home-courses`);
	const json = await res.json(); const courses = json.courses ?? []; const categories = json.categories ?? []

	// The bookstore row never blocks the homepage: null when it cannot be loaded.
	const books = await safeHomeSections();

	// Pass data to the page via props
	return { props: { courses, categories, books } };
}

export default Home;
