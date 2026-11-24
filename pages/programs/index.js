import React from "react";
import Head from "next/head";
import Navbar from "@/components/_App/Navbar";
import Footer from "@/components/_App/Footer";
import ProgramCards from "@/components/Programs/ProgramCards";
import { PageHeader, SectionHeader } from "@/components/ui";
import DemoBand from "@/components/FreeDemo/DemoBand";

// Programs overview (the parent entry of the header's Programs dropdown).
const Programs = ({ user }) => (
	<>
		<Head>
			<title>Programs | SharpStudy</title>
			<meta name="description" content="Personality Enrichment, MathX, Leadership and Public Speaking: SharpStudy's four learning programs." />
		</Head>
		<Navbar user={user} />
		<PageHeader
			title="Our learning programs"
			description="Four programs that build confidence, thinking and communication."
			crumbs={[{ href: "/", label: "Home" }, { label: "Programs" }]}
		/>
		<main id="programs-main">
			<section className="ss-section" aria-labelledby="programs-all">
				<div className="ss-container">
					<SectionHeader eyebrow="Programs" title={<span id="programs-all">Choose a program</span>} />
					<ProgramCards />
				</div>
			</section>
			<DemoBand source="programs_overview_cta" title="Not sure which program fits?" text="Book a free demo class and we will help you choose." />
		</main>
		<Footer />
	</>
);

export default Programs;
