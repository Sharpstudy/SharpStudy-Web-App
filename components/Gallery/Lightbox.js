import React, { useEffect, useRef } from "react";
import Link from "next/link";
import { SHOWCASE_CATEGORIES } from "@/lib/gallery/showcase";

// Accessible lightbox for the gallery: role="dialog" + aria-modal, Escape closes, ArrowLeft/ArrowRight move, Tab is kept inside, scrolling of
// the page behind is locked, and focus returns to whatever opened it (the parent restores it through `onClose`).
const Lightbox = ({ items, index, onClose, onStep }) => {
	const dialog = useRef(null);
	const closeBtn = useRef(null);
	const item = items[index];

	useEffect(() => {
		const prevOverflow = document.body.style.overflow;
		document.body.style.overflow = "hidden";
		if (closeBtn.current) closeBtn.current.focus();
		return () => {
			document.body.style.overflow = prevOverflow;
		};
	}, []);

	useEffect(() => {
		const onKey = (e) => {
			if (e.key === "Escape") onClose();
			else if (e.key === "ArrowRight") onStep(1);
			else if (e.key === "ArrowLeft") onStep(-1);
			else if (e.key === "Tab" && dialog.current) {
				const f = [...dialog.current.querySelectorAll("button, a[href]")].filter((n) => !n.disabled);
				if (f.length === 0) return;
				const first = f[0];
				const last = f[f.length - 1];
				if (e.shiftKey && document.activeElement === first) {
					e.preventDefault();
					last.focus();
				} else if (!e.shiftKey && document.activeElement === last) {
					e.preventDefault();
					first.focus();
				}
			}
		};
		document.addEventListener("keydown", onKey);
		return () => document.removeEventListener("keydown", onKey);
	}, [onClose, onStep]);

	if (!item) return null;
	const cat = (SHOWCASE_CATEGORIES.find((c) => c.slug === item.category) || {}).label;
	return (
		<div className="ss-lightbox ss-lightbox--gallery" role="dialog" aria-modal="true" aria-labelledby="lb-title" aria-describedby="lb-desc" onClick={onClose}>
			<div className="ss-lightbox__panel" ref={dialog} onClick={(e) => e.stopPropagation()}>
				<button type="button" ref={closeBtn} className="ss-lightbox__close" aria-label="Close" onClick={onClose}>
					<i className="ri-close-line" aria-hidden="true"></i>
				</button>
				<div className="ss-lightbox__stage">
					{items.length > 1 && (
						<button type="button" className="ss-lightbox__nav ss-lightbox__nav--prev" aria-label="Previous image" onClick={() => onStep(-1)}>
							<i className="ri-arrow-left-s-line" aria-hidden="true"></i>
						</button>
					)}
					{/* eslint-disable-next-line @next/next/no-img-element */}
					<img key={item.id} src={item.image} alt={item.alt} width={item.width} height={item.height} />
					{items.length > 1 && (
						<button type="button" className="ss-lightbox__nav ss-lightbox__nav--next" aria-label="Next image" onClick={() => onStep(1)}>
							<i className="ri-arrow-right-s-line" aria-hidden="true"></i>
						</button>
					)}
				</div>
				<div className="ss-lightbox__info">
					<span className="ss-badge ss-badge--soft">{cat}</span>
					<span className="ss-lightbox__count" aria-live="polite">
						{index + 1} / {items.length}
					</span>
					<h3 id="lb-title">{item.title}</h3>
					<p id="lb-desc">{item.description}</p>
					{item.route && (
						<Link href={item.route}>
							<a className="ss-btn ss-btn--sm">
								{item.linkLabel || "Learn more"} <i className="ri-arrow-right-line" aria-hidden="true"></i>
							</a>
						</Link>
					)}
				</div>
			</div>
		</div>
	);
};

export default Lightbox;
