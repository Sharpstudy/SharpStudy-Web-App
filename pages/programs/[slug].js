import React from "react";
import Head from "next/head";
import Navbar from "@/components/_App/Navbar";
import Footer from "@/components/_App/Footer";
import ProgramPage from "@/components/Programs/ProgramPage";
import { programBySlug } from "@/lib/programs/catalog";

// Public program page (/programs/personality-enrichment, /programs/mathx, /programs/leadership, /programs/public-speaking).
const Program = ({ program, user }) => (
	<>
		<Head>
			<title>{`${program.title} | SharpStudy`}</title>
			<meta name="description" content={program.short} />
		</Head>
		<Navbar user={user} />
		<ProgramPage program={program} user={user} />
		<Footer />
	</>
);

export async function getServerSideProps({ params, req, res }) {
	const program = programBySlug(params.slug);
	if (!program) return { notFound: true };
	// Same shared-cache rule as the homepage: only logged-out requests (no login cookie) may be cached briefly.
	if (!(req.cookies && req.cookies.edmy_users_token)) res.setHeader("Cache-Control", "public, max-age=0, s-maxage=60, stale-while-revalidate=300");
	return { props: { program } };
}

export default Program;
