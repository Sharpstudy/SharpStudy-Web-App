import React, { useCallback, useEffect, useRef, useState } from "react";
import { EmptyState } from "@/components/ui";
import { GALLERY_CATEGORIES, filterByCategory, usedCategories } from "@/lib/gallery/items";

// Responsive gallery with optional category filters (only categories that have photos) and an accessible lightbox
// (role="dialog", Escape closes, arrow keys move, focus returns to the thumbnail). `items` must already be publishable.
const GalleryView = ({ items }) => {
	const [category, setCategory] = useState("");
	const [open, setOpen] = useState(-1);
	const opener = useRef(null);
	const closeBtn = useRef(null);
	const cats = usedCategories(items);
	const shown = filterByCategory(items, category);
	const label = (slug) => (GALLERY_CATEGORIES.find((c) => c.slug === slug) || {}).label || "";

	const close = useCallback(() => {
		setOpen(-1);
		if (opener.current) opener.current.focus();
	}, []);
	const step = useCallback((d) => setOpen((i) => (i < 0 ? i : (i + d + shown.length) % shown.length)), [shown.length]);

	useEffect(() => {
		if (open < 0) return undefined;
		const onKey = (e) => {
			if (e.key === "Escape") close();
			else if (e.key === "ArrowRight") step(1);
			else if (e.key === "ArrowLeft") step(-1);
		};
		document.addEventListener("keydown", onKey);
		const prev = document.body.style.overflow;
		document.body.style.overflow = "hidden";
		if (closeBtn.current) closeBtn.current.focus();
		return () => {
			document.removeEventListener("keydown", onKey);
			document.body.style.overflow = prev;
		};
	}, [open, close, step]);

	if (items.length === 0) {
		return (
			<EmptyState
				icon="ri-image-2-line"
				title="Photos are coming soon"
				description="We will share pictures from our workshops, classroom activities, events and competitions here, once the learners and families involved have given their consent."
			/>
		);
	}
	const current = open >= 0 ? shown[open] : null;
	return (
		<>
			{cats.length > 1 && (
				<ul className="ss-blogcats ss-gallery__cats" aria-label="Gallery categories">
					<li>
						<button type="button" aria-pressed={category === ""} onClick={() => setCategory("")}>
							All
						</button>
					</li>
					{cats.map((c) => (
						<li key={c.slug}>
							<button type="button" aria-pressed={category === c.slug} onClick={() => setCategory(c.slug)}>
								{c.label}
							</button>
						</li>
					))}
				</ul>
			)}
			<ul className="ss-gallery">
				{shown.map((it, i) => (
					<li key={it.id}>
						<button
							type="button"
							className="ss-gallery__item"
							aria-label={`Open photo: ${it.alt}`}
							onClick={(e) => {
								opener.current = e.currentTarget;
								setOpen(i);
							}}
						>
							{/* eslint-disable-next-line @next/next/no-img-element */}
							<img src={it.src} alt={it.alt} loading="lazy" />
							<span className="ss-gallery__tag">{label(it.category)}</span>
						</button>
					</li>
				))}
			</ul>
			{current && (
				<div className="ss-lightbox" role="dialog" aria-modal="true" aria-label={current.alt} onClick={close}>
					<div className="ss-lightbox__inner" onClick={(e) => e.stopPropagation()}>
						<button type="button" ref={closeBtn} className="ss-lightbox__close" aria-label="Close photo" onClick={close}>
							<i className="ri-close-line" aria-hidden="true"></i>
						</button>
						{shown.length > 1 && (
							<>
								<button type="button" className="ss-lightbox__nav ss-lightbox__nav--prev" aria-label="Previous photo" onClick={() => step(-1)}>
									<i className="ri-arrow-left-s-line" aria-hidden="true"></i>
								</button>
								<button type="button" className="ss-lightbox__nav ss-lightbox__nav--next" aria-label="Next photo" onClick={() => step(1)}>
									<i className="ri-arrow-right-s-line" aria-hidden="true"></i>
								</button>
							</>
						)}
						{/* eslint-disable-next-line @next/next/no-img-element */}
						<img src={current.src} alt={current.alt} />
						<p className="ss-lightbox__cap">{current.caption || current.alt}</p>
					</div>
				</div>
			)}
		</>
	);
};

export default GalleryView;
