import React from "react";
import Head from "next/head";
import Navbar from "@/components/_App/Navbar";
import Footer from "@/components/_App/Footer";
import { PageHeader } from "@/components/ui";
import MeetingRequestForm from "@/components/Meetings/MeetingRequestForm";

const ScheduleACall = ({ user }) => (
	<>
		<Head>
			<title>Schedule a call — SharpStudy</title>
			<meta name="description" content="Request a meeting with the SharpStudy team: product demos, course enquiries, partnerships and support." />
		</Head>
		<Navbar user={user} />
		<main>
			<PageHeader
				title="Schedule a call"
				description="Tell us when you would like to talk. We review every request and confirm by email."
				crumbs={[{ href: "/", label: "Home" }, { label: "Schedule a call" }]}
			/>
			<div className="ss-container ss-meeting">
				<MeetingRequestForm />
			</div>
		</main>
		<Footer />
	</>
);

export default ScheduleACall;
