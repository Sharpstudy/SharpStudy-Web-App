import React from "react";
import { SectionHeader } from "@/components/ui";

// "Meet Our Leadership": the two co-founders. Names, designations and descriptions are the exact text supplied by SharpStudy; the
// photographs are the supplied files in public/images/team/.
const FOUNDERS = [
	{
		id: "najeeb",
		name: "MD. Najeeb Uddin",
		role: "Co-Founder, SharpStudy",
		focus: ["Technology", "AI", "Product development"],
		image: "/images/team/md-najeeb-uddin.png",
		alt: "Photograph of MD. Najeeb Uddin, Co-Founder of SharpStudy",
		bio: [
			"Leading SharpStudy's technology and product development, building AI-powered solutions, and turning innovative ideas into scalable products. Focused on creating smarter learning experiences through technology, AI, and product innovation.",
		],
	},
	{
		id: "mike",
		name: "Mike Qureshi",
		role: "Co-Founder | Business Strategy, Innovation & Growth",
		focus: ["Business strategy", "Innovation", "Growth"],
		image: "/images/team/mike-qureshi.png",
		alt: "Photograph of Mike Qureshi, Co-Founder of SharpStudy",
		bio: [
			"Mike Qureshi is a technology entrepreneur, startup leader, and venture builder with experience in building teams, developing disruptive products, driving innovation, and supporting businesses through growth and funding opportunities.",
			"As Co-Founder of SharpStudy, Mike contributes to the company's strategic vision, business development, growth initiatives, partnerships, and long-term direction. His focus is on transforming innovative ideas into impactful products, building sustainable business models, and creating opportunities for SharpStudy to grow and scale.",
		],
	},
];

const Leadership = () => (
	<section className="ss-section ss-section--tint" aria-labelledby="leadership-title">
		<div className="ss-container">
			<SectionHeader
				align="center"
				eyebrow="Our team"
				title={<span id="leadership-title">Meet Our Leadership</span>}
				description="The people shaping SharpStudy's technology, vision and growth."
			/>
			<ul className="ss-founders">
				{FOUNDERS.map((f) => (
					<li key={f.id} className="ss-founder">
						<div className="ss-founder__photo">
							{/* eslint-disable-next-line @next/next/no-img-element */}
							<img src={f.image} alt={f.alt} width="640" height="640" loading="lazy" />
						</div>
						<div className="ss-founder__body">
							<h3>{f.name}</h3>
							<p className="ss-founder__role">{f.role}</p>
							<ul className="ss-founder__focus" aria-label={`${f.name}, areas of focus`}>
								{f.focus.map((t) => (
									<li key={t}>{t}</li>
								))}
							</ul>
							{f.bio.map((p) => (
								<p key={p}>{p}</p>
							))}
						</div>
					</li>
				))}
			</ul>
		</div>
	</section>
);

export default Leadership;
