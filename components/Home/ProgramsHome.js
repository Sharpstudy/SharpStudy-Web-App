import React from "react";
import Link from "next/link";
import { Button, SectionHeader } from "@/components/ui";
import { BookFreeDemoButton } from "@/components/FreeDemo/FreeDemoProvider";
import ProgramCards from "@/components/Programs/ProgramCards";

// Program-focused homepage sections. Copy is descriptive only: no statistics, prices, testimonials or claims are invented here
// (testimonials come from the admin-managed API in Trust.js).

export const Intro = () => (
	<section className="ss-section" aria-labelledby="intro-title">
		<div className="ss-container ss-split">
			<div className="ss-split__copy">
				<span className="ss-eyebrow">Welcome to SharpStudy</span>
				<h2 id="intro-title">A place to grow the skills that matter</h2>
				<p className="ss-lead">
					SharpStudy Learning Inc. is a project-based cognitive skills development platform that uses advanced pedagogy for practical and enhanced
					learning. Learners team up to learn and apply communication, presentation and problem-solving skills in real time.
				</p>
				<Button href="/about-us/" variant="secondary" iconRight="ri-arrow-right-line">
					Read our story
				</Button>
			</div>
			<ul className="ss-feature-grid">
				{[
					{ icon: "ri-lightbulb-flash-line", title: "Learn by doing", text: "Activities, projects and practice in every program." },
					{ icon: "ri-group-line", title: "Learn together", text: "Team challenges, discussion and live classes." },
					{ icon: "ri-line-chart-line", title: "See your progress", text: "Track what you have completed and pick up where you left off." },
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
);

export const FeaturedPrograms = () => (
	<section className="ss-section ss-section--tint" id="programs" aria-labelledby="programs-title">
		<div className="ss-container">
			<SectionHeader
				align="center"
				eyebrow="Our programs"
				title={<span id="programs-title">Four programs, one growing learner</span>}
				description="Pick a program to see its modules, activities and assessments."
			/>
			<ProgramCards />
		</div>
	</section>
);

const approach = [
	{ icon: "ri-compass-3-line", title: "Explore", text: "Start with a program and its modules, each built around a clear skill." },
	{ icon: "ri-hand-heart-line", title: "Practise", text: "Lessons, activities and quizzes let learners apply each idea straight away." },
	{ icon: "ri-award-line", title: "Grow", text: "Progress is tracked per course so learners can resume where they stopped." },
];
export const Approach = () => (
	<section className="ss-section" aria-labelledby="approach-title">
		<div className="ss-container">
			<SectionHeader align="center" eyebrow="Our approach" title={<span id="approach-title">How learning works here</span>} />
			<ol className="ss-steps">
				{approach.map((s, i) => (
					<li key={s.title} className="ss-card ss-step">
						<span className="ss-step__num" aria-hidden="true">
							{i + 1}
						</span>
						<span className="ss-icon-tile ss-icon-tile--lg" aria-hidden="true">
							<i className={s.icon}></i>
						</span>
						<h3>{s.title}</h3>
						<p>{s.text}</p>
					</li>
				))}
			</ol>
		</div>
	</section>
);

const platform = [
	{ href: "/study/", icon: "ri-bar-chart-line", title: "Mastery Ladder", text: "Step-by-step practice that adapts as learners improve." },
	{ href: "/learning/live/", icon: "ri-live-line", title: "Live classes", text: "Interactive classes with instructors, online." },
	{ href: "/study/", icon: "ri-robot-line", title: "Sage AI tutor", text: "A friendly AI tutor for questions while learning." },
];
export const Platform = () => (
	<section className="ss-section ss-section--tint" aria-labelledby="platform-title">
		<div className="ss-container">
			<SectionHeader align="center" eyebrow="On the platform" title={<span id="platform-title">Tools that support every program</span>} />
			<ul className="ss-grid ss-grid--3 ss-platform">
				{platform.map((p) => (
					<li key={p.title} className="ss-card ss-card--interactive">
						<Link href={p.href}>
							<a>
								<span className="ss-icon-tile ss-icon-tile--lg" aria-hidden="true">
									<i className={p.icon}></i>
								</span>
								<h3>{p.title}</h3>
								<p>{p.text}</p>
							</a>
						</Link>
					</li>
				))}
			</ul>
		</div>
	</section>
);

export const ProgramsCta = ({ user }) => (
	<section className="ss-section ss-section--tight">
		<div className="ss-container">
			<div className="ss-cta">
				<div>
					<h2>Start Your Child&apos;s Learning Journey</h2>
					<p>Try a free demo class, explore the programs, then log in to begin learning.</p>
				</div>
				<div className="ss-cta__actions">
					<BookFreeDemoButton source="homepage_footer" size="lg">
						Book a Free Demo
					</BookFreeDemoButton>
					<Button href="#programs" variant="light" size="lg">
						See the programs
					</Button>
					{!user && (
						<Button href="/auth" size="lg" className="ss-btn--outline-light">
							Login
						</Button>
					)}
				</div>
			</div>
		</div>
	</section>
);
