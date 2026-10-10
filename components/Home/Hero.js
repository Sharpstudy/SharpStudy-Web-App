import React from "react";
import Image from "next/image";
import { Button } from "@/components/ui";

const HUBSPOT_URL = "https://meetings.hubspot.com/mike1162";

const highlights = [
	{ icon: "ri-lightbulb-flash-line", label: "Project-based learning" },
	{ icon: "ri-route-line", label: "Adaptive learning paths" },
	{ icon: "ri-timer-flash-line", label: "Bite-sized lessons" },
	{ icon: "ri-trophy-line", label: "Gamified practice" },
];

const Hero = () => (
	<section className="ss-hero" aria-labelledby="hero-title">
		<div className="ss-container ss-hero__grid">
			<div className="ss-hero__copy">
				<span className="ss-eyebrow">
					<i className="ri-magic-line" aria-hidden="true"></i> Workshops for the age of AI
				</span>
				<h1 id="hero-title">
					Build the skills that make you <span>future‑ready</span>
				</h1>
				<p className="ss-hero__lead">
					SharpStudy imparts critical cognitive, technical and business skills to the
					next generation of leaders through transformational, project‑based workshops.
				</p>
				<div className="ss-hero__ctas">
					<Button href="/courses/" size="lg" iconRight="ri-arrow-right-line">
						Explore courses
					</Button>
					<Button href={HUBSPOT_URL} external size="lg" variant="secondary" icon="ri-calendar-line">
						Schedule a call
					</Button>
				</div>
				<ul className="ss-hero__chips" aria-label="How SharpStudy teaches">
					{highlights.map((h) => (
						<li key={h.label}>
							<i className={h.icon} aria-hidden="true"></i>
							{h.label}
						</li>
					))}
				</ul>
			</div>
			<div className="ss-hero__art">
				<div className="ss-hero__img">
					<Image
						layout="responsive"
						src="/images/workshops.png"
						alt="Learners collaborating in a SharpStudy workshop"
						width={1278}
						height={871}
						priority
						sizes="(min-width: 992px) 560px, 90vw"
					/>
				</div>
			</div>
		</div>
	</section>
);

export default Hero;
