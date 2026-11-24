import React, { useEffect, useRef, useState } from "react";
import { SectionHeader } from "@/components/ui";
import { PORTRAITS_AVAILABLE, TRAINERS, trainerImagesShown } from "@/lib/trainers/data";

// Neutral placeholder shown until the real portraits are added (see lib/trainers/data.js). Not a photograph and not a person.
const Silhouette = () => (
	<svg className="ss-trainer__ph" viewBox="0 0 160 200" aria-hidden="true" focusable="false">
		<rect width="160" height="200" fill="#d7ecfc" />
		<circle cx="130" cy="30" r="46" fill="#fbe19a" opacity=".7" />
		<circle cx="28" cy="176" r="34" fill="#f9afc8" opacity=".55" />
		<circle cx="80" cy="78" r="30" fill="#fff" />
		<path d="M24 200c0-38 24-62 56-62s56 24 56 62z" fill="#fff" />
	</svg>
);

// Ten profile cards. Portraits are AI-generated illustrations of FICTIONAL people (disclosed in the notice below the cards).
const Trainers = () => {
	const ref = useRef(null);
	const [armed, setArmed] = useState(false);
	useEffect(() => {
		const el = ref.current;
		if (!el || !window.IntersectionObserver || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return undefined;
		setArmed(true);
		const io = new IntersectionObserver(
			(entries) =>
				entries.forEach((e) => {
					if (e.isIntersecting) {
						e.target.classList.add("is-in");
						io.unobserve(e.target);
					}
				}),
			{ threshold: 0.12 }
		);
		el.querySelectorAll(".ss-trainer").forEach((n) => io.observe(n));
		return () => io.disconnect();
	}, []);

	const shown = trainerImagesShown();
	return (
		<section className="ss-section" aria-labelledby="trainers-title">
			<div className="ss-container ss-container--wide">
				<SectionHeader align="center" eyebrow="Meet our team" title={<span id="trainers-title">Meet Our Expert Trainers</span>} description="Discover the people and expertise behind meaningful learning experiences." />
				<ul ref={ref} className={`ss-trainers${armed ? " is-armed" : ""}`}>
					{TRAINERS.map((t, i) => (
						<li key={t.id} className="ss-trainer" style={{ "--i": i % 5 }}>
							<div className="ss-trainer__photo">
								{PORTRAITS_AVAILABLE ? (
									// eslint-disable-next-line @next/next/no-img-element
									<img src={t.image} alt={t.alt} width={t.width} height={t.height} loading="lazy" decoding="async" />
								) : (
									<Silhouette />
								)}
							</div>
							<div className="ss-trainer__body">
								<h3>{t.label}</h3>
								<span className="ss-trainer__area">{t.area}</span>
								<p>{t.text}</p>
							</div>
						</li>
					))}
				</ul>
				<p className="ss-trainers__note">
					{shown
						? "Portraits are AI-generated illustrations of fictional people, not photographs of SharpStudy staff."
						: "These are illustrative placeholder profiles. Real trainer names and photographs will be added when the team is announced."}
				</p>
			</div>
		</section>
	);
};

export default Trainers;
