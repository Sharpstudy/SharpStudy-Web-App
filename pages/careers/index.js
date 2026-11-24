import React from "react";
import Head from "next/head";
import Navbar from "@/components/_App/Navbar";
import Footer from "@/components/_App/Footer";
import { Button, EmptyState, PageHeader, SectionHeader } from "@/components/ui";
import { JOB_TYPES, JOBS, openJobs } from "@/lib/careers/jobs";

// Careers. Vacancies come from lib/careers/jobs.js (empty until SharpStudy publishes one). Teaching and telecaller interest goes through
// the EXISTING application workflows (/become-an-instructor/, /become-a-telecaller/); everything else goes through the contact page.
const Job = ({ job }) => (
	<li className="ss-card ss-job">
		<h3>{job.title}</h3>
		{job.location && <p className="ss-muted">{job.location}</p>}
		<p>{job.summary}</p>
		{job.responsibilities && job.responsibilities.length > 0 && (
			<>
				<h4>Responsibilities</h4>
				<ul className="ss-checks">
					{job.responsibilities.map((t) => (
						<li key={t}>
							<i className="ri-check-line" aria-hidden="true"></i>
							{t}
						</li>
					))}
				</ul>
			</>
		)}
		{job.qualifications && job.qualifications.length > 0 && (
			<>
				<h4>Required qualifications</h4>
				<ul className="ss-checks">
					{job.qualifications.map((t) => (
						<li key={t}>
							<i className="ri-award-line" aria-hidden="true"></i>
							{t}
						</li>
					))}
				</ul>
			</>
		)}
		{job.experience && (
			<p>
				<strong>Experience:</strong> {job.experience}
			</p>
		)}
		<Button href={job.applyHref} iconRight="ri-arrow-right-line">
			Apply
		</Button>
	</li>
);

const Careers = ({ user }) => {
	const jobs = openJobs(JOBS);
	return (
		<>
			<Head>
				<title>Careers | SharpStudy</title>
				<meta name="description" content="Work with SharpStudy: teaching and non-teaching opportunities." />
			</Head>
			<Navbar user={user} />
			<PageHeader title="Careers at SharpStudy" description="Help the next generation of learners build skills that last." crumbs={[{ href: "/", label: "Home" }, { label: "Careers" }]} />
			<main id="careers-main">
				<section className="ss-section" aria-labelledby="why-title">
					<div className="ss-container ss-split">
						<div className="ss-split__copy">
							<span className="ss-eyebrow">Why SharpStudy</span>
							<h2 id="why-title">Work on learning that matters</h2>
							<p className="ss-lead">
								SharpStudy Learning Inc. is a project-based cognitive skills development platform. Our mission is to make the world future-ready by imparting
								critical cognitive, technical and business skills to the next generation of leaders.
							</p>
						</div>
						<ul className="ss-feature-grid">
							{[
								{ icon: "ri-slideshow-2-line", title: "Teach", text: "Run courses, lessons, quizzes and live classes on the platform." },
								{ icon: "ri-lightbulb-flash-line", title: "Project-based learning", text: "Help learners learn by building and applying." },
								{ icon: "ri-team-line", title: "Four programs", text: "Personality Enrichment, MathX, Leadership and Public Speaking." },
							].map((f) => (
								<li key={f.title} className="ss-card ss-feature">
									<span className="ss-icon-tile" aria-hidden="true">
										<i className={f.icon}></i>
									</span>
									<h3>{f.title}</h3>
									<p>{f.text}</p>
								</li>
							))}
						</ul>
					</div>
				</section>

				<section className="ss-section ss-section--tint" aria-labelledby="open-title">
					<div className="ss-container">
						<SectionHeader eyebrow="Opportunities" title={<span id="open-title">Current openings</span>} />
						{jobs.length === 0 ? (
							<EmptyState
								icon="ri-briefcase-4-line"
								title="There are no openings right now"
								description="We are not advertising any vacancies at the moment. You can still tell us you are interested using the options below."
							/>
						) : (
							JOB_TYPES.map((t) => {
								const list = jobs.filter((j) => j.type === t.slug);
								return (
									list.length > 0 && (
										<div key={t.slug} className="ss-jobgroup">
											<h3 className="ss-sectiontitle">{t.label}</h3>
											<ul className="ss-grid ss-grid--2">
												{list.map((j) => (
													<Job key={j.id} job={j} />
												))}
											</ul>
										</div>
									)
								);
							})
						)}
					</div>
				</section>

				<section className="ss-section" aria-labelledby="apply-title">
					<div className="ss-container">
						<SectionHeader
							align="center"
							eyebrow="Get in touch"
							title={<span id="apply-title">Interested in joining us?</span>}
							description="These use SharpStudy's existing application and contact forms."
						/>
						<div className="ss-grid ss-grid--3">
							<div className="ss-card ss-audience">
								<span className="ss-icon-tile ss-icon-tile--lg" aria-hidden="true">
									<i className="ri-slideshow-2-line"></i>
								</span>
								<h3>Teaching</h3>
								<p>Apply to become an instructor on SharpStudy. An account is needed, and applications are reviewed by the team.</p>
								<Button href="/become-an-instructor/" variant="soft" iconRight="ri-arrow-right-line">
									Become an instructor
								</Button>
							</div>
							<div className="ss-card ss-audience">
								<span className="ss-icon-tile ss-icon-tile--lg" aria-hidden="true">
									<i className="ri-customer-service-2-line"></i>
								</span>
								<h3>Telecaller</h3>
								<p>Apply as a telecaller to coordinate meeting requests and help people discover SharpStudy.</p>
								<Button href="/become-a-telecaller/" variant="soft" iconRight="ri-arrow-right-line">
									Apply as telecaller
								</Button>
							</div>
							<div className="ss-card ss-audience">
								<span className="ss-icon-tile ss-icon-tile--lg" aria-hidden="true">
									<i className="ri-mail-send-line"></i>
								</span>
								<h3>Something else?</h3>
								<p>Tell us about yourself and what you would like to do.</p>
								<Button href="/contact-us/" variant="soft" iconRight="ri-arrow-right-line">
									Contact us
								</Button>
							</div>
						</div>
					</div>
				</section>
			</main>
			<Footer />
		</>
	);
};

export default Careers;
