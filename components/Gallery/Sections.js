import React, { useState } from "react";
import Link from "next/link";
import { Button, SectionHeader } from "@/components/ui";
import { HERO_VIDEO } from "@/lib/site/heroMedia";

const Shot = ({ item, onOpen, eager }) => (
	<button type="button" className="ss-shot" onClick={(e) => onOpen(item.id, e.currentTarget)} aria-label={`Open larger image: ${item.title}`}>
		{/* eslint-disable-next-line @next/next/no-img-element */}
		<img src={item.image} alt={item.alt} width={item.width} height={item.height} loading={eager ? "eager" : "lazy"} decoding="async" />
		<span className="ss-shot__zoom" aria-hidden="true">
			<i className="ri-zoom-in-line"></i>
		</span>
	</button>
);

// Section 3: the four programs, each with its own page screenshot and a link to the real program route.
export const ProgramsSection = ({ items, onOpen }) => (
	<section className="ss-gsec" aria-labelledby="g-programs">
		<div className="ss-container ss-container--wide">
		<SectionHeader align="center" eyebrow="Our programs" title={<span id="g-programs">Explore our programs</span>} description="Four programs, each with its own page." />
		<ul className="ss-gprograms">
			{items.map((p) => (
				<li key={p.id} className="ss-gcard ss-reveal">
					<Shot item={p} onOpen={onOpen} />
					<div className="ss-gcard__body">
						<h3>{p.title}</h3>
						<p>{p.description}</p>
						<Link href={p.route}>
							<a className="ss-gcard__link">
								{p.linkLabel} <i className="ri-arrow-right-line" aria-hidden="true"></i>
							</a>
						</Link>
					</div>
				</li>
			))}
		</ul>
		</div>
	</section>
);

// Section 4: real screens of the running site.
export const PlatformSection = ({ items, onOpen }) => (
	<section className="ss-gsec ss-gsec--tint" aria-labelledby="g-platform">
		<div className="ss-container ss-container--wide">
		<SectionHeader align="center" eyebrow="Inside SharpStudy" title={<span id="g-platform">A look inside the platform</span>} description="Real screenshots of the public SharpStudy site." />
		<ul className="ss-gplatform">
			{items.map((p, i) => (
				<li key={p.id} className={`ss-gcard ss-reveal${i === 0 ? " ss-gcard--feature" : ""}`}>
					<Shot item={p} onOpen={onOpen} />
					<div className="ss-gcard__body">
						<span className="ss-badge ss-badge--soft">Screenshot</span>
						<h3>{p.title}</h3>
						<p>{p.description}</p>
						{p.route && (
							<Link href={p.route}>
								<a className="ss-gcard__link">
									{p.linkLabel || "Learn more"} <i className="ri-arrow-right-line" aria-hidden="true"></i>
								</a>
							</Link>
						)}
					</div>
				</li>
			))}
		</ul>
		</div>
	</section>
);

// Section 5: learning experiences: real program-page screenshots plus clearly labelled illustrated topics.
export const ExperiencesSection = ({ shots, topics, onOpen }) => (
	<section className="ss-gsec" aria-labelledby="g-exp">
		<div className="ss-container ss-container--wide">
		<SectionHeader align="center" eyebrow="Learning experiences" title={<span id="g-exp">How learning happens</span>} description="Illustrations show the kinds of learning SharpStudy supports; they are artwork, not photographs of events." />
		{topics.length > 0 && (
			<ul className="ss-gtopics">
				{topics.map((t) => (
					<li key={t.id} className={`ss-gtopic ss-gtopic--${t.tone} ss-reveal`}>
						<span className="ss-gtopic__art" aria-hidden="true">
							<i className={t.icon}></i>
						</span>
						<h3>{t.title}</h3>
						<p>{t.description}</p>
						<span className="ss-gtopic__tag">Illustration</span>
					</li>
				))}
			</ul>
		)}
		{shots.length > 0 && (
			<>
				<h3 className="ss-sectiontitle">From the program pages</h3>
				<ul className="ss-gshots">
					{shots.map((p) => (
						<li key={p.id} className="ss-gcard ss-reveal">
							<Shot item={p} onOpen={onOpen} />
							<div className="ss-gcard__body">
								<span className="ss-badge ss-badge--soft">Screenshot</span>
								<h3>{p.title}</h3>
								<p>{p.description}</p>
							</div>
						</li>
					))}
				</ul>
			</>
		)}
		</div>
	</section>
);

const MOSAIC = ["lg", "", "tall", "wide", "wide", "wide", "wide"];
// Section 6: mosaic of genuine screenshots (and, once added, consented photographs). Opens the lightbox.
export const MosaicSection = ({ items, onOpen, category }) => (
	<section className="ss-gsec ss-gsec--tint" aria-labelledby="g-moments">
		<div className="ss-container ss-container--wide">
		<SectionHeader align="center" eyebrow="Moments" title={<span id="g-moments">Activities and learning moments</span>} description="Click any picture to see it larger." />
		{items.length > 0 ? (
			<ul className="ss-mosaic">
				{items.map((m, i) => (
					<li key={m.id} className={`ss-mosaic__cell ss-reveal ss-mosaic__cell--${MOSAIC[i % MOSAIC.length] || "sm"}`}>
						<button type="button" className="ss-mosaic__btn" onClick={(e) => onOpen(m.id, e.currentTarget)} aria-label={`Open larger image: ${m.title}`}>
							{/* eslint-disable-next-line @next/next/no-img-element */}
							<img src={m.image} alt={m.alt} width={m.width} height={m.height} loading="lazy" decoding="async" />
							<span className="ss-mosaic__cap">
								<strong>{m.title}</strong>
							</span>
						</button>
					</li>
				))}
			</ul>
		) : (
			<p className="ss-muted" style={{ textAlign: "center" }}>
				{category === "activities" ? "Photos of classroom and learning activities will be added here once the learners and families involved have given their consent." : "Nothing to show here yet."}
			</p>
		)}
		</div>
	</section>
);

// Section 7: the existing landing page video. The poster is a frame from the video; the video itself loads only when Play is pressed.
export const VideoSection = () => {
	const [playing, setPlaying] = useState(false);
	const [failed, setFailed] = useState(false);
	if (!HERO_VIDEO) return null;
	return (
		<section className="ss-gsec" aria-labelledby="g-video">
		<div className="ss-container ss-container--wide">
			<SectionHeader align="center" eyebrow="Featured video" title={<span id="g-video">SharpStudy in motion</span>} description="The SharpStudy landing page video." />
			<div className="ss-gvideo ss-reveal">
				{playing && !failed ? (
					<video src={HERO_VIDEO.mp4} poster={HERO_VIDEO.poster} controls autoPlay playsInline preload="auto" onError={() => setFailed(true)} aria-label="SharpStudy landing page video" />
				) : (
					<button type="button" className="ss-gvideo__poster" onClick={() => { setFailed(false); setPlaying(true); }} aria-label="Play the SharpStudy landing page video">
						{/* eslint-disable-next-line @next/next/no-img-element */}
						<img src={HERO_VIDEO.poster} alt="A still from the SharpStudy landing page video: a mentor and two learners at a table" width="1280" height="720" loading="lazy" decoding="async" />
						<span className="ss-gvideo__play" aria-hidden="true">
							<i className="ri-play-circle-line"></i>
						</span>
					</button>
				)}
				{failed && <p className="ss-muted" role="alert">The video could not be played right now.</p>}
			</div>
			</div>
		</section>
	);
};

// Section 8: achievements. There is no verified achievement content yet, so this is an honest coming-soon panel.
export const AchievementsSection = () => (
	<section className="ss-gsec ss-gsec--soon" aria-labelledby="g-ach">
		<div className="ss-container ss-container--wide">
		<div className="ss-gsoon ss-reveal">
			<div className="ss-gsoon__art" aria-hidden="true">
				<i className="ri-trophy-line"></i>
				<i className="ri-star-smile-line"></i>
				<i className="ri-medal-line"></i>
			</div>
			<div>
				<span className="ss-eyebrow">Achievements</span>
				<h2 id="g-ach">Student Achievements Coming Soon</h2>
				<p>
					Genuine student projects, achievements and success stories will be shared here, with the consent of the learners and families involved. Until then, you can read what our learners
					have said.
				</p>
				<Button href="/success-stories/" variant="secondary" iconRight="ri-arrow-right-line">
					Read success stories
				</Button>
			</div>
		</div>
		</div>
	</section>
);
