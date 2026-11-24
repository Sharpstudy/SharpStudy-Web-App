import React from "react";
import Link from "next/link";
import { Button } from "@/components/ui";
import { HeroScene } from "@/components/ui/Illustration";

// Education-focused homepage hero. Search uses the existing course catalogue search (/courses/?search=) and the chips are the
// existing course categories passed in from the homepage data. No statistics or claims here that need data.
const HIGHLIGHTS = [
	{ href: "/study/", icon: "ri-bar-chart-line", label: "Mastery Ladder" },
	{ href: "/learning/live/", icon: "ri-live-line", label: "Live Classes" },
	{ href: "/study/", icon: "ri-robot-line", label: "Sage AI Tutor" },
];

const Hero = ({ categories = [] }) => (
	<section className="ss-hero" aria-labelledby="hero-title">
		<div className="ss-container ss-hero__grid">
			<div className="ss-hero__copy">
				<span className="ss-eyebrow">
					<i className="ri-slideshow-2-line" aria-hidden="true"></i> Courses, live classes and AI tutoring
				</span>
				<h1 id="hero-title">
					Learn it. Practise it. <span>Love learning.</span>
				</h1>
				<p className="ss-hero__lead">
					Project-based courses, live interactive classes, a Mastery Ladder for practice and Sage, your AI tutor, all in one friendly place.
				</p>
				<form action="/courses/" method="get" role="search" className="ss-herosearch ss-hero__search">
					<label htmlFor="hero-course-search" className="visually-hidden">
						Search courses
					</label>
					<input id="hero-course-search" name="search" type="search" maxLength={80} placeholder="Search courses…" autoComplete="off" />
					<button type="submit" className="ss-btn">
						<i className="ri-search-line" aria-hidden="true"></i> Search
					</button>
				</form>
				<div className="ss-hero__ctas">
					<Button href="/courses/" size="lg" iconRight="ri-arrow-right-line">
						Explore Courses
					</Button>
				</div>
				<ul className="ss-hero__chips" aria-label="Learning highlights">
					{HIGHLIGHTS.map((h) => (
						<li key={h.label}>
							<Link href={h.href}>
								<a>
									<i className={h.icon} aria-hidden="true"></i>
									{h.label}
								</a>
							</Link>
						</li>
					))}
				</ul>
				{categories.length > 0 && (
					<ul className="ss-hero__chips" aria-label="Course categories">
						{categories.slice(0, 8).map((c) => (
							<li key={c.id}>
								<Link href={`/category/${c.slug}`}>
									<a>
										<i className="ri-book-3-line" aria-hidden="true"></i>
										{c.name}
									</a>
								</Link>
							</li>
						))}
					</ul>
				)}
			</div>
			<div className="ss-hero__art">
				<HeroScene className="ss-hero__scene" />
			</div>
		</div>
	</section>
);

export default Hero;
