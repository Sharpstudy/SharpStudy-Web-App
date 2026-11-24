import React, { useEffect, useState } from "react";
import Navbar from "@/components/_App/Navbar";
import Footer from "@/components/_App/Footer";
import { useRouter } from "next/router";
import baseUrl from "@/utils/baseUrl";
import axios from "axios";
import CourseOverview from "@/components/Learning/CourseOverview";
import LiveClassComponent from "@/components/Learning/LiveClassComponent";
import Script from "next/script";
import { PageHeader } from "@/components/ui";

const Index = ({ user }) => {
	const [course, setCourse] = useState({});

	const {
		query: { slug },
	} = useRouter();

	const fetchVideos = async () => {
		const payload = {
			params: { slug: slug },
		};
		const url = `${baseUrl}/api/courses/course`;
		const response = await axios.get(url, payload);
		setCourse(response.data.course);
	};

	useEffect(() => {
		if (slug) fetchVideos();
	}, [slug]);

	return (
		<>
			<Navbar user={user} />

			{/* Jitsi API is only needed here (was loaded on every page via Layout) */}
			<Script src="https://meet.jit.si/external_api.js" strategy="afterInteractive" />
			<main>
				<PageHeader
					title={(course && course.title) || "Live class"}
					description="Join the live session for this course."
					crumbs={[
						{ href: "/learning/my-courses/", label: "My learning" },
						{ label: "Live class" },
					]}
				/>
				<div className="ss-container ss-container--wide ss-student">
					<LiveClassComponent slug={slug} {...user} />
					<section className="ss-class-overview" aria-label="About this course">
						<h2>About this course</h2>
						<CourseOverview {...course} />
					</section>
				</div>
			</main>

			<Footer />
		</>
	);
};

export default Index;
