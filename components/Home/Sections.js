// Static homepage sections. Copy is taken from the previous homepage
// (Features / Teaching / Business / Transform) — no invented claims or stats.
import React from "react";
import Link from "next/link";
import { Button, SectionHeader } from "@/components/ui";

const HUBSPOT_URL = "https://meetings.hubspot.com/mike1162";

export const Categories = ({ categories }) => {
	if (!categories || categories.length === 0) return null;
	return (
		<section className="ss-section ss-section--tight" aria-labelledby="discover-title">
			<div className="ss-container">
				<SectionHeader
					eyebrow="Discover"
					title={<span id="discover-title">Find your subject</span>}
					description="Browse learning paths by category."
					action={
						<Button href="/courses/" variant="ghost" iconRight="ri-arrow-right-line">
							All courses
						</Button>
					}
				/>
				<ul className="ss-cat-grid">
					{categories.map((cat, i) => (
						<li key={cat.id}>
							<Link href={`/category/${cat.slug}`}>
								<a className="ss-cat">
									<span className={`ss-icon-tile ss-cat__icon tone-${i % 4}`} aria-hidden="true">
										<i className="ri-book-3-line"></i>
									</span>
									<span className="ss-cat__name">{cat.name}</span>
									<i className="ri-arrow-right-up-line ss-cat__go" aria-hidden="true"></i>
								</a>
							</Link>
						</li>
					))}
				</ul>
			</div>
		</section>
	);
};

const steps = [
	{
		icon: "ri-compass-3-line",
		title: "Choose a course",
		text: "Explore the catalogue by subject and pick a course or workshop that fits your goals.",
	},
	{
		icon: "ri-play-circle-line",
		title: "Learn by doing",
		text: "Work through video lessons, downloadable resources, quizzes and live classes at your own pace.",
	},
	{
		icon: "ri-award-line",
		title: "Track progress & certify",
		text: "See your progress in each course and earn a certificate when you complete it.",
	},
];

export const HowItWorks = () => (
	<section className="ss-section ss-section--tint" aria-labelledby="how-title">
		<div className="ss-container">
			<SectionHeader
				align="center"
				eyebrow="How it works"
				title={<span id="how-title">From curiosity to capability in three steps</span>}
			/>
			<ol className="ss-steps">
				{steps.map((s, i) => (
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

const features = [
	{
		img: "/images/features/feature-1.svg",
		title: "Project-based learning",
		text: "Immersive education where real-world challenges inspire innovation and hands-on learning.",
	},
	{
		img: "/images/features/feature-2.svg",
		title: "Adaptive learning",
		text: "Learning roadmaps tailored to each student's capabilities and educational background.",
	},
	{
		img: "/images/features/feature-3.svg",
		title: "Microlearning",
		text: "Concise, engaging modules delivered as ongoing micro-lessons.",
	},
	{
		img: "/images/features/feature-4.svg",
		title: "Gamified learning",
		text: "Leaderboards and contests that motivate learners and build teamwork.",
	},
];

export const Benefits = () => (
	<section className="ss-section" aria-labelledby="why-title">
		<div className="ss-container">
			<div className="ss-split">
				<div className="ss-split__copy">
					<span className="ss-eyebrow">Why SharpStudy</span>
					<h2 id="why-title">Creating leaders and visionaries of tomorrow</h2>
					<p className="ss-lead">
						Learners team up to learn and apply technology, communication, presentation
						and business skills in real time — through project-based learning,
						internships and problem solving.
					</p>
					<Button href="/about-us/" variant="secondary" iconRight="ri-arrow-right-line">
						About SharpStudy
					</Button>
				</div>
				<ul className="ss-feature-grid">
					{features.map((f) => (
						<li key={f.title} className="ss-card ss-feature">
							{/* eslint-disable-next-line @next/next/no-img-element */}
							<img src={f.img} alt="" width="48" height="48" loading="lazy" />
							<h3>{f.title}</h3>
							<p>{f.text}</p>
						</li>
					))}
				</ul>
			</div>
		</div>
	</section>
);

const instructorPerks = [
	{ icon: "ri-video-upload-line", label: "Upload video lessons" },
	{ icon: "ri-folder-zip-line", label: "Share course assets" },
	{ icon: "ri-questionnaire-line", label: "Build quizzes" },
	{ icon: "ri-live-line", label: "Run live classes" },
];

export const Audiences = () => (
	<section className="ss-section ss-section--tight" aria-label="For instructors and organisations">
		<div className="ss-container ss-grid ss-grid--2">
			<div className="ss-card ss-audience">
				<span className="ss-icon-tile ss-icon-tile--lg ss-icon-tile--info" aria-hidden="true">
					<i className="ri-slideshow-2-line"></i>
				</span>
				<h2>Teach on SharpStudy</h2>
				<p>
					We provide the tools to teach what you love — create a course, publish
					lessons and help learners reach their goals.
				</p>
				<ul className="ss-checks">
					{instructorPerks.map((p) => (
						<li key={p.label}>
							<i className={p.icon} aria-hidden="true"></i>
							{p.label}
						</li>
					))}
				</ul>
				<Button href="/become-an-instructor/" variant="soft" iconRight="ri-arrow-right-line">
					Become an instructor
				</Button>
			</div>
			<div className="ss-card ss-audience ss-audience--dark">
				<span className="ss-icon-tile ss-icon-tile--lg" aria-hidden="true">
					<i className="ri-building-4-line"></i>
				</span>
				<h2>SharpStudy for business</h2>
				<p>
					Elevate your team with corporate training workshops tailored to build skills
					and confidence for modern technical and business challenges.
				</p>
				<Button href={HUBSPOT_URL} external variant="light" icon="ri-calendar-line">
					Talk to our team
				</Button>
			</div>
		</div>
	</section>
);

export const FinalCta = ({ user }) => (
	<section className="ss-section ss-section--tight">
		<div className="ss-container">
			<div className="ss-cta">
				<div>
					<h2>Ready to start learning?</h2>
					<p>Pick a course today and learn at your own pace, on any device.</p>
				</div>
				<div className="ss-cta__actions">
					<Button href="/courses/" variant="light" size="lg">
						Browse courses
					</Button>
					{!user && (
						<Button href="/auth" size="lg" className="ss-btn--outline-light">
							Create an account
						</Button>
					)}
				</div>
			</div>
		</div>
	</section>
);
