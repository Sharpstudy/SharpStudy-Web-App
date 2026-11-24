import React, { useEffect, useState } from "react";
import Link from "next/link";
import axios from "axios";
import baseUrl from "@/utils/baseUrl";
import CoursesList from "@/components/Courses/CoursesList";
import ProgramArt from "./ProgramArt";
import ProgramCards from "./ProgramCards";
import { Button, EmptyState, SectionHeader } from "@/components/ui";
import { BookFreeDemoButton } from "@/components/FreeDemo/FreeDemoProvider";
import DemoBand from "@/components/FreeDemo/DemoBand";
import { sourceForProgram } from "@/lib/freeDemo/config";

const List = ({ items, icon }) => (
	<ul className="ss-checks">
		{items.map((t) => (
			<li key={t}>
				<i className={icon} aria-hidden="true"></i>
				{t}
			</li>
		))}
	</ul>
);

// One program page: MARKETING content, open to everyone. The program's courses (the approved courses in the category whose slug equals the
// program slug, read through /api/categories/[slug], which needs a login) are only loaded and shown for a SIGNED-IN account. A visitor
// sees the program information and the Free Demo buttons, and no course, price, cart or enrolment option.
const ProgramPage = ({ program, user }) => {
	const [courses, setCourses] = useState([]);
	const [enrolled, setEnrolled] = useState([]);

	useEffect(() => {
		if (!user) {
			setCourses([]);
			return undefined;
		}
		let alive = true;
		axios
			.get(`${baseUrl}/api/categories/${program.slug}`)
			.then((r) => alive && setCourses((r.data && r.data.courses && r.data.courses.courses) || []))
			.catch(() => alive && setCourses([]));
		return () => {
			alive = false;
		};
	}, [user, program.slug]);

	// A signed-in learner sees their own enrolments in this program (existing endpoint, requires their login token).
	useEffect(() => {
		if (!user || courses.length === 0) return undefined;
		let alive = true;
		axios
			.get(`${baseUrl}/api/learnings/my-purchases`)
			.then((r) => {
				const mine = new Set(((r.data && r.data.enrolments) || []).map((e) => e.course && e.course.slug).filter(Boolean));
				if (alive) setEnrolled(courses.filter((c) => mine.has(c.slug)));
			})
			.catch(() => alive && setEnrolled([]));
		return () => {
			alive = false;
		};
	}, [user, courses]);

	return (
		<main id="program-main">
			<section className={`ss-prog-hero ss-prog-hero--${program.tone}`} aria-labelledby="program-title">
				<div className="ss-container ss-prog-hero__grid">
					<div>
						<nav aria-label="Breadcrumb">
							<ol className="ss-breadcrumb ss-breadcrumb--light">
								<li>
									<Link href="/">
										<a>Home</a>
									</Link>
								</li>
								<li>
									<Link href="/programs/">
										<a>Programs</a>
									</Link>
								</li>
								<li aria-current="page">{program.title}</li>
							</ol>
						</nav>
						<h1 id="program-title">{program.title}</h1>
						<p className="ss-prog-hero__lead">{program.short}</p>
						<div className="ss-prog-hero__cta">
							<BookFreeDemoButton source={sourceForProgram(program.slug)} program={program.slug} size="lg" icon="ri-calendar-check-line">
								Book a Free {program.title} Demo
							</BookFreeDemoButton>
							{user && (
								<Button href="#available" variant="secondary" size="lg" iconRight="ri-arrow-down-line">
									{courses.length > 0 ? "See courses" : "Enrolment"}
								</Button>
							)}
							<Button href="#curriculum" variant="light" size="lg">
								View curriculum
							</Button>
						</div>
					</div>
					<ProgramArt slug={program.slug} tone={program.tone} className="ss-prog-hero__art" />
				</div>
			</section>

			<section className="ss-section" aria-labelledby="overview-title">
				<div className="ss-container ss-split">
					<div className="ss-split__copy">
						<span className="ss-eyebrow">Overview</span>
						<h2 id="overview-title">What is {program.title}?</h2>
						<p className="ss-lead">{program.overview}</p>
					</div>
					<div className="ss-card">
						<h3 className="ss-card__title">Learning objectives</h3>
						<List items={program.objectives} icon="ri-focus-3-line" />
					</div>
				</div>
			</section>

			<section className="ss-section ss-section--tint" id="curriculum" aria-labelledby="curriculum-title">
				<div className="ss-container">
					<SectionHeader
						align="center"
						eyebrow="Curriculum"
						title={<span id="curriculum-title">Modules</span>}
						description="A proposed curriculum outline. Lessons for each module are added by the program's instructors."
					/>
					<ol className="ss-modules">
						{program.modules.map((m, i) => (
							<li key={m.title} className="ss-card ss-module">
								<span className="ss-module__num" aria-hidden="true">
									{i + 1}
								</span>
								<h3>{m.title}</h3>
								<p>{m.text}</p>
							</li>
						))}
					</ol>
				</div>
			</section>

			<section className="ss-section" aria-labelledby="outcomes-title">
				<div className="ss-container">
					<SectionHeader eyebrow="Learning journey" title={<span id="outcomes-title">Outcomes, activities and assessments</span>} />
					<div className="ss-grid ss-grid--3">
						<div className="ss-card">
							<h3 className="ss-card__title">Expected learning outcomes</h3>
							<List items={program.outcomes} icon="ri-seedling-line" />
						</div>
						<div className="ss-card">
							<h3 className="ss-card__title">Activities</h3>
							<List items={program.activities} icon="ri-gamepad-line" />
						</div>
						<div className="ss-card">
							<h3 className="ss-card__title">Assessments</h3>
							<List items={program.assessments} icon="ri-task-line" />
						</div>
					</div>
				</div>
			</section>

			{user && (
			<section className="ss-section ss-section--tint" id="available" aria-labelledby="available-title">
				<div className="ss-container">
					<SectionHeader
						eyebrow="Enrol"
						title={<span id="available-title">Courses in {program.title}</span>}
						description="Published courses for this program. Open a course to see its lessons and enrol."
					/>
					{user && enrolled.length > 0 && (
						<div className="ss-card ss-resume">
							<h3 className="ss-card__title">Continue learning</h3>
							<ul>
								{enrolled.map((c) => (
									<li key={c.id}>
										<span>{c.title}</span>
										<Button href={`/learning/course/${c.slug}`} size="sm" iconRight="ri-arrow-right-line">
											Resume
										</Button>
									</li>
								))}
							</ul>
						</div>
					)}
					<CoursesList
						courses={courses}
						user={user}
						empty={
							<EmptyState
								icon="ri-time-line"
								title="Courses are coming soon"
								description={`No ${program.title} course has been published yet. Check back soon.`}
								action={
									user ? (
										<Button href="/learning/my-courses/" variant="secondary">
											My learning
										</Button>
									) : (
										<Button href="/auth" variant="secondary">
											Login
										</Button>
									)
								}
							/>
						}
					/>
				</div>
			</section>
			)}

			<DemoBand
				source={sourceForProgram(program.slug)}
				program={program.slug}
				title={`Try ${program.title} with a free demo class`}
				text="See how a class works before you decide. We will confirm your slot by email."
				label="Book a Free Demo"
			/>

			<section className="ss-section" aria-labelledby="other-title">
				<div className="ss-container">
					<SectionHeader eyebrow="More programs" title={<span id="other-title">Explore the other programs</span>} />
					<ProgramCards exclude={program.slug} />
				</div>
			</section>
		</main>
	);
};

export default ProgramPage;
