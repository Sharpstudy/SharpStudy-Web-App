import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { EmptyState } from "@/components/ui";
import Lightbox from "./Lightbox";
import { AchievementsSection, ExperiencesSection, MosaicSection, PlatformSection, ProgramsSection, VideoSection } from "./Sections";
import { SHOWCASE_CATEGORIES, SHOWCASE_ITEMS, itemsFor, lightboxItems, matchesCategory } from "@/lib/gallery/showcase";
import { HERO_VIDEO } from "@/lib/site/heroMedia";

// Category filter + all sections + lightbox. Choosing a category shows only the sections that have items in it; the lightbox walks through
// exactly the images currently visible. Reveal-on-scroll is armed only after load, and never with reduced motion.
const GalleryExplorer = () => {
	const [category, setCategory] = useState("all");
	const [openId, setOpenId] = useState(null);
	const opener = useRef(null);
	const root = useRef(null);

	const sections = useMemo(() => {
		const pick = (s) => itemsFor(SHOWCASE_ITEMS, category, (i) => i.section === s);
		const programs = pick("programs");
		const platform = pick("platform");
		const shots = pick("experiences").filter((i) => i.type === "screenshot");
		const topics = pick("experiences").filter((i) => i.type === "illustration");
		const moments = itemsFor(SHOWCASE_ITEMS, category, (i) => i.moment);
		const video = !!HERO_VIDEO && (category === "all" || category === "inside");
		const achievements = category === "all" || category === "achievements";
		return { programs, platform, shots, topics, moments, video, achievements };
	}, [category]);

	// Images in display order, no duplicates: this is what the lightbox steps through.
	const ordered = useMemo(() => lightboxItems([...sections.programs, ...sections.platform, ...sections.shots, ...sections.moments]), [sections]);
	const index = openId ? ordered.findIndex((i) => i.id === openId) : -1;

	const onOpen = useCallback((id, el) => {
		opener.current = el;
		setOpenId(id);
	}, []);
	const onClose = useCallback(() => {
		setOpenId(null);
		const el = opener.current;
		if (el && document.contains(el)) el.focus();
	}, []);
	const onStep = useCallback(
		(d) => setOpenId((id) => {
			const i = ordered.findIndex((x) => x.id === id);
			return i < 0 ? id : ordered[(i + d + ordered.length) % ordered.length].id;
		}),
		[ordered]
	);

	// Reveal on scroll (restrained): cards fade up once. Armed after mount; skipped with reduced motion or no IntersectionObserver.
	useEffect(() => {
		const el = root.current;
		if (!el || !window.IntersectionObserver || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return undefined;
		el.classList.add("is-armed");
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
		el.querySelectorAll(".ss-reveal:not(.is-in)").forEach((n) => io.observe(n));
		return () => io.disconnect();
	}, [category]);

	const total = ordered.length + sections.topics.length;
	const nothing = !sections.programs.length && !sections.platform.length && !sections.shots.length && !sections.topics.length && !sections.moments.length && !sections.video && !sections.achievements;

	return (
		<div id="gallery-explorer" ref={root}>
			<div className="ss-gfilter">
				<div className="ss-container ss-container--wide">
					<ul className="ss-gfilter__list" aria-label="Gallery categories">
						{SHOWCASE_CATEGORIES.map((c) => (
							<li key={c.slug}>
								<button type="button" className="ss-gfilter__btn" aria-pressed={category === c.slug} onClick={() => setCategory(c.slug)}>
									{c.label}
									<span className="visually-hidden"> ({SHOWCASE_ITEMS.filter((i) => matchesCategory(i, c.slug)).length} items)</span>
								</button>
							</li>
						))}
					</ul>
				</div>
			</div>
			<p className="visually-hidden" role="status" aria-live="polite">
				Showing {total} item{total === 1 ? "" : "s"} in {(SHOWCASE_CATEGORIES.find((c) => c.slug === category) || {}).label}
			</p>

			<div className="ss-gcontent" key={category}>
				{sections.programs.length > 0 && <ProgramsSection items={sections.programs} onOpen={onOpen} />}
				{sections.platform.length > 0 && <PlatformSection items={sections.platform} onOpen={onOpen} />}
				{(sections.topics.length > 0 || sections.shots.length > 0) && <ExperiencesSection shots={sections.shots} topics={sections.topics} onOpen={onOpen} />}
				{(sections.moments.length > 0 || category === "activities") && <MosaicSection items={sections.moments} onOpen={onOpen} category={category} />}
				{sections.video && <VideoSection />}
				{sections.achievements && <AchievementsSection />}
				{nothing && <EmptyState icon="ri-image-2-line" title="Nothing published here yet" description="Pictures for this category will appear here once they are available." />}
			</div>

			{index >= 0 && <Lightbox items={ordered} index={index} onClose={onClose} onStep={onStep} />}
		</div>
	);
};

export default GalleryExplorer;
