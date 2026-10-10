// Testimonials and partners come from the admin-managed APIs; sections hide
// themselves when there is nothing real to show.
import React, { useEffect, useState } from "react";
import axios from "axios";
import baseUrl from "@/utils/baseUrl";
import { SectionHeader } from "@/components/ui";

const useList = (path, key) => {
	const [items, setItems] = useState(null);
	useEffect(() => {
		let alive = true;
		axios
			.get(`${baseUrl}${path}`)
			.then((r) => alive && setItems(r.data[key] || []))
			.catch(() => alive && setItems([]));
		return () => {
			alive = false;
		};
	}, [path, key]);
	return items;
};

export const Testimonials = () => {
	const items = useList("/api/testimonials", "testimonials");
	if (!items || items.length === 0) return null;
	return (
		<section className="ss-section ss-section--tint" aria-labelledby="voices-title">
			<div className="ss-container">
				<SectionHeader
					align="center"
					eyebrow="Testimonials"
					title={<span id="voices-title">What our learners say</span>}
				/>
				<ul className="ss-quotes">
					{items.map((t) => (
						<li key={t.id} className="ss-card ss-quote">
							<i className="ri-double-quotes-l ss-quote__mark" aria-hidden="true"></i>
							<blockquote>{t.description}</blockquote>
							<figure className="ss-quote__who">
								{/* eslint-disable-next-line @next/next/no-img-element */}
								<img className="ss-avatar" src={t.image_url} alt="" loading="lazy" />
								<figcaption>
									<strong>{t.name}</strong>
									{t.designation && <span>{t.designation}</span>}
								</figcaption>
							</figure>
						</li>
					))}
				</ul>
			</div>
		</section>
	);
};

export const Partners = () => {
	const items = useList("/api/partners", "partners");
	if (!items || items.length === 0) return null;
	return (
		<section className="ss-section ss-section--tight" aria-labelledby="partners-title">
			<div className="ss-container">
				<p id="partners-title" className="ss-partners__title">
					Our partners
				</p>
				<ul className="ss-partners">
					{items.map((p) => (
						<li key={p.id}>
							{/* eslint-disable-next-line @next/next/no-img-element */}
							<img src={p.partner_image} alt={p.name} loading="lazy" />
						</li>
					))}
				</ul>
			</div>
		</section>
	);
};
