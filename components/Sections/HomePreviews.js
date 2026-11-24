import React from "react";
import Link from "next/link";
import { Button, SectionHeader } from "@/components/ui";
import StoryCards from "./StoryCards";
import useTestimonials from "./useTestimonials";
import GalleryView from "./GalleryView";
import { GALLERY_ITEMS, publishableItems } from "@/lib/gallery/items";
import { blogData } from "@/utils/sampleData";
import { latestPosts } from "@/lib/blog/helpers";

// Homepage previews. Each one reads the same source as its full page (testimonials API, lib/gallery/items.js, the existing blog list)
// and shows an honest note instead of invented content when there is nothing to show yet.

export const SuccessPreview = () => {
	const items = useTestimonials();
	if (items === null) return null;
	return (
		<section className="ss-section" aria-labelledby="stories-prev-title">
			<div className="ss-container">
				<SectionHeader
					eyebrow="Success stories"
					title={<span id="stories-prev-title">What our learners say</span>}
					action={
						<Button href="/success-stories/" variant="secondary" iconRight="ri-arrow-right-line">
							All stories
						</Button>
					}
				/>
				{items.length > 0 ? <StoryCards items={items.slice(0, 3)} /> : <p className="ss-muted">Learner and parent stories will be shared here once the people involved have agreed to be featured.</p>}
			</div>
		</section>
	);
};

export const GalleryPreview = () => {
	const items = publishableItems(GALLERY_ITEMS).slice(0, 6);
	return (
		<section className="ss-section ss-section--tint" aria-labelledby="gallery-prev-title">
			<div className="ss-container">
				<SectionHeader
					eyebrow="Gallery"
					title={<span id="gallery-prev-title">Moments from our classes</span>}
					action={
						<Button href="/gallery/" variant="secondary" iconRight="ri-arrow-right-line">
							Open gallery
						</Button>
					}
				/>
				{items.length > 0 ? <GalleryView items={items} /> : <p className="ss-muted">Pictures from our workshops, events and competitions will appear here, with the consent of the learners and families involved.</p>}
			</div>
		</section>
	);
};

export const BlogPreview = () => {
	const posts = latestPosts(blogData, 3);
	if (posts.length === 0) return null;
	return (
		<section className="ss-section" aria-labelledby="blog-prev-title">
			<div className="ss-container">
				<SectionHeader
					eyebrow="Blog"
					title={<span id="blog-prev-title">Latest articles</span>}
					action={
						<Button href="/blog/blogs/" variant="secondary" iconRight="ri-arrow-right-line">
							All articles
						</Button>
					}
				/>
				<div className="ss-grid ss-grid--cards">
					{posts.map((b) => (
						<article className="ss-course-card" key={b.id}>
							<div className="ss-course-card__media">
								{/* eslint-disable-next-line @next/next/no-img-element */}
								<img src={b.image} alt="" loading="lazy" onError={(e) => { e.currentTarget.style.display = "none"; }} />
							</div>
							<div className="ss-course-card__body">
								<span className="ss-badge ss-badge--soft">{b.category}</span>
								<h3 className="ss-course-card__title">
									<Link href={`/blog/${b.id}`}>
										<a>{b.title}</a>
									</Link>
								</h3>
								<span className="ss-muted">{b.date}</span>
							</div>
						</article>
					))}
				</div>
			</div>
		</section>
	);
};

export const CareersCta = () => (
	<section className="ss-section ss-section--tight" aria-labelledby="careers-prev-title">
		<div className="ss-container">
			<div className="ss-card ss-careers-cta">
				<div>
					<span className="ss-eyebrow">Careers</span>
					<h2 id="careers-prev-title">Join the SharpStudy team</h2>
					<p>Interested in teaching or working with us? See how to get in touch.</p>
				</div>
				<Button href="/careers/" size="lg" iconRight="ri-arrow-right-line">
					Explore careers
				</Button>
			</div>
		</div>
	</section>
);
