import React, { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui";
import { BookFreeDemoButton } from "@/components/FreeDemo/FreeDemoProvider";
import { HeroScene } from "@/components/ui/Illustration";
import { HERO_VIDEO, HERO_VIDEO_MIN_WIDTH } from "@/lib/site/heroMedia";
import { STATS, STATS_NOTE } from "@/lib/site/stats";

// Background video for the hero (only when lib/site/heroMedia.js configures one). It is attempted only for visitors on a wide screen who have
// not asked for reduced motion or data saving; everyone else, and anyone whose video fails to load, sees the poster (or the plain indigo hero).
// It is decorative (aria-hidden, muted, looping) and has a pause button so it never plays without a way to stop it.
const HeroVideo = ({ media }) => {
	const ref = useRef(null);
	const [mode, setMode] = useState("off"); // off | playing | paused
	useEffect(() => {
		if (typeof window === "undefined" || !window.matchMedia) return;
		const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
		const wide = window.matchMedia(`(min-width: ${HERO_VIDEO_MIN_WIDTH}px)`).matches;
		const save = !!(navigator.connection && navigator.connection.saveData);
		setMode(!reduce && wide && !save ? "playing" : "off");
	}, []);
	const toggle = () => {
		const v = ref.current;
		if (!v) return;
		if (v.paused) {
			v.play()
				.then(() => setMode("playing"))
				.catch(() => setMode("paused"));
		} else {
			v.pause();
			setMode("paused");
		}
	};
	return (
		<>
			<div className="ss-hero__media" aria-hidden="true">
				{media.poster && (
					// eslint-disable-next-line @next/next/no-img-element
					<img className="ss-hero__poster" src={media.poster} alt="" />
				)}
				{mode !== "off" && (
					<video ref={ref} className="ss-hero__video" autoPlay muted loop playsInline preload="metadata" poster={media.poster} tabIndex={-1} onError={() => setMode("off")}>
						{media.webm && <source src={media.webm} type="video/webm" />}
						<source src={media.mp4} type="video/mp4" />
					</video>
				)}
				<span className="ss-hero__shade"></span>
			</div>
			{mode !== "off" && (
				<button type="button" className="ss-hero__pause" onClick={toggle} aria-label={mode === "playing" ? "Pause background video" : "Play background video"}>
					<i className={mode === "playing" ? "ri-pause-line" : "ri-play-line"} aria-hidden="true"></i>
				</button>
			)}
		</>
	);
};

export const ProgramsHero = () => (
	<section className={`ss-hero${HERO_VIDEO ? " ss-hero--video" : ""}`} aria-labelledby="hero-title">
		{HERO_VIDEO && <HeroVideo media={HERO_VIDEO} />}
		<div className="ss-container ss-hero__grid">
			<div className="ss-hero__copy">
				<span className="ss-eyebrow">
					<i className="ri-seedling-line" aria-hidden="true"></i> Learning and skill development
				</span>
				<h1 id="hero-title">
					Skills for life, <span>made fun.</span>
				</h1>
				<p className="ss-hero__lead">
					SharpStudy helps learners build confidence, sharper thinking and clear communication through four programs: Personality Enrichment, MathX,
					Leadership and Public Speaking.
				</p>
				<div className="ss-hero__ctas">
					<BookFreeDemoButton source="homepage_hero" size="lg" icon="ri-calendar-check-line">
						Book Your Free Demo Class
					</BookFreeDemoButton>
					<Button href="#programs" variant="secondary" size="lg" iconRight="ri-arrow-down-line">
						Discover the programs
					</Button>
					<Button href="/about-us/" variant="light" size="lg">
						About SharpStudy
					</Button>
				</div>
			</div>
			{!HERO_VIDEO && (
				<div className="ss-hero__art">
					<HeroScene className="ss-hero__scene" />
				</div>
			)}
		</div>
	</section>
);

// Four achievement figures (supplied content, see lib/site/stats.js). Cards fade and slide in once as they scroll into view; the numbers are
// in the page from the start (no count-up), and with reduced motion or without JavaScript everything is simply visible.
export const Stats = () => {
	const ref = useRef(null);
	const [armed, setArmed] = useState(false);
	const [seen, setSeen] = useState(false);
	useEffect(() => {
		const el = ref.current;
		if (!el || typeof window === "undefined" || !window.IntersectionObserver || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return undefined;
		setArmed(true);
		const io = new IntersectionObserver(
			(entries) => {
				if (entries.some((e) => e.isIntersecting)) {
					setSeen(true);
					io.disconnect();
				}
			},
			{ threshold: 0.2 }
		);
		io.observe(el);
		return () => io.disconnect();
	}, []);
	return (
		<section className="ss-stats-wrap" aria-labelledby="stats-title">
			<div className="ss-container">
				<h2 id="stats-title" className="visually-hidden">
					SharpStudy in numbers
				</h2>
				<ul ref={ref} className={`ss-stats${armed ? " is-armed" : ""}${seen ? " is-seen" : ""}`}>
					{STATS.map((s, i) => (
						<li key={s.id} className={`ss-stat ss-stat--${s.tone}`} style={{ "--i": i }}>
							<strong className="ss-stat__value">{s.value}</strong>
							<span className="ss-stat__label">{s.label}</span>
						</li>
					))}
				</ul>
				<p className="ss-stats__note">{STATS_NOTE}</p>
			</div>
		</section>
	);
};
