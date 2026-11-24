import React from "react";
import { Button } from "@/components/ui";

// Gallery hero: headline on indigo with an editorial collage of REAL SharpStudy screenshots (public pages) and soft shapes. No claims about
// learners, awards or schools.
const HeroCollage = () => (
	<div className="ss-ghero__collage" aria-hidden="true">
		<span className="ss-ghero__blob ss-ghero__blob--a"></span>
		<span className="ss-ghero__blob ss-ghero__blob--b"></span>
		{/* eslint-disable-next-line @next/next/no-img-element */}
		<img className="ss-ghero__img ss-ghero__img--1" src="/images/gallery/platform/homepage-hero.webp" alt="" width="1280" height="800" />
		{/* eslint-disable-next-line @next/next/no-img-element */}
		<img className="ss-ghero__img ss-ghero__img--2" src="/images/gallery/programs/mathx-program.webp" alt="" width="1280" height="800" />
		{/* eslint-disable-next-line @next/next/no-img-element */}
		<img className="ss-ghero__img ss-ghero__img--3" src="/images/gallery/platform/homepage-mobile.webp" alt="" width="390" height="844" />
		{/* eslint-disable-next-line @next/next/no-img-element */}
		<img className="ss-ghero__img ss-ghero__img--4" src="/images/gallery/programs/leadership-program.webp" alt="" width="1280" height="800" />
	</div>
);

const GalleryHero = () => (
	<section className="ss-ghero" aria-labelledby="gallery-title">
		<div className="ss-container ss-container--wide ss-ghero__grid">
			<div className="ss-ghero__copy">
				<span className="ss-eyebrow">SharpStudy Gallery</span>
				<h1 id="gallery-title">
					Every Learning Journey <span>Has a Story</span>
				</h1>
				<p className="ss-ghero__lead">Explore the ideas, experiences, learning tools and moments that make learning with SharpStudy meaningful.</p>
				<div className="ss-ghero__cta">
					<Button href="#gallery-explorer" size="lg" iconRight="ri-arrow-down-line">
						Explore Our Gallery
					</Button>
					<Button href="/programs/" variant="secondary" size="lg">
						Discover Our Programs
					</Button>
				</div>
			</div>
			<HeroCollage />
		</div>
		<svg className="ss-ghero__wave" viewBox="0 0 1440 80" preserveAspectRatio="none" aria-hidden="true" focusable="false">
			<path d="M0 40C180 0 360 0 540 30S900 80 1080 50 1320 10 1440 30V80H0Z" fill="#fbf7ee" />
		</svg>
	</section>
);

export default GalleryHero;
