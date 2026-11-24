import React from "react";

// Testimonial cards (same markup/classes as the existing Testimonials section). Content is exactly what an admin published.
const StoryCards = ({ items }) => (
	<ul className="ss-quotes">
		{items.map((t) => (
			<li key={t.id} className="ss-card ss-quote">
				<i className="ri-double-quotes-l ss-quote__mark" aria-hidden="true"></i>
				<blockquote>{t.description}</blockquote>
				<figure className="ss-quote__who">
					{t.image_url && (
						// eslint-disable-next-line @next/next/no-img-element
						<img className="ss-avatar" src={t.image_url} alt="" loading="lazy" />
					)}
					<figcaption>
						<strong>{t.name}</strong>
						{t.designation && <span>{t.designation}</span>}
					</figcaption>
				</figure>
			</li>
		))}
	</ul>
);

export default StoryCards;
