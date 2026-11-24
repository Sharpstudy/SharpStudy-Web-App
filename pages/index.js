import React from "react";
import Navbar from "@/components/_App/Navbar";
import Footer from "@/components/_App/Footer";
import { SuccessPreview, GalleryPreview, BlogPreview, CareersCta } from "@/components/Sections/HomePreviews";
import { ProgramsHero, Stats } from "@/components/Home/HeroStats";
import { Intro, FeaturedPrograms, Approach, Platform, ProgramsCta } from "@/components/Home/ProgramsHome";
import { landingRedirect } from "@/lib/auth/landing";

const Home = ({ user }) => {
	return (
		<>
			<Navbar user={user} />
			<main>
				<ProgramsHero />
				<Stats />
				<Intro />
				<FeaturedPrograms />
				<Approach />
				<Platform />
				<SuccessPreview />
				<GalleryPreview />
				<BlogPreview />
				<CareersCta />
				<ProgramsCta user={user} />
			</main>
			<Footer />
		</>
	);
};

// This gets called on every request
export async function getServerSideProps({ req, res: serverResponse }) {
	// Signed-in students/instructors never see the marketing homepage.
	const redirect = await landingRedirect(req).catch(() => null);
	if (redirect) return { redirect };
	// A visitor without a login cookie gets the same public page as every other visitor, so a CDN may keep it briefly (60 s fresh, then
	// served stale for up to 5 min while it refreshes). Browsers still revalidate each time. A request that carries the login cookie never
	// gets this header (it is redirected above or rendered privately), so personal responses are never shared.
	if (!(req.cookies && req.cookies.edmy_users_token)) serverResponse.setHeader("Cache-Control", "public, max-age=0, s-maxage=60, stale-while-revalidate=300");
	return { props: {} };
}

export default Home;
