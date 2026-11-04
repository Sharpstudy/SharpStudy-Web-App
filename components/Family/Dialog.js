import React, { useEffect, useRef } from "react";
import { Icon } from "./art";

// Accessible modal for the family screens (a bottom sheet on phones). Focus moves in and is trapped,
// Escape and the backdrop close it, and focus returns to the opener.
const Dialog = ({ open, title, onClose, children, size = "md", label }) => {
	const box = useRef(null);
	const opener = useRef(null);

	useEffect(() => {
		if (!open) return;
		opener.current = document.activeElement;
		const el = box.current;
		const focusables = () => Array.from(el.querySelectorAll('button:not([disabled]), input:not([disabled]), select, textarea, [href], [tabindex]:not([tabindex="-1"])'));
		const first = focusables().find((n) => n.tagName === "INPUT") || focusables()[1] || focusables()[0];
		(first || el).focus();
		const onKey = (e) => {
			if (e.key === "Escape") {
				e.preventDefault();
				onClose();
			} else if (e.key === "Tab") {
				const f = focusables();
				if (!f.length) return;
				if (e.shiftKey && document.activeElement === f[0]) {
					e.preventDefault();
					f[f.length - 1].focus();
				} else if (!e.shiftKey && document.activeElement === f[f.length - 1]) {
					e.preventDefault();
					f[0].focus();
				}
			}
		};
		document.addEventListener("keydown", onKey);
		const prev = document.body.style.overflow;
		document.body.style.overflow = "hidden";
		return () => {
			document.removeEventListener("keydown", onKey);
			document.body.style.overflow = prev;
			if (opener.current && opener.current.focus) opener.current.focus();
		};
	}, [open, onClose]);

	if (!open) return null;
	return (
		<div className="fm-modal" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
			<div ref={box} className={`fm-sheet fm-sheet--${size}`} role="dialog" aria-modal="true" aria-label={label || title} tabIndex={-1}>
				<span className="fm-sheet__grab" aria-hidden="true" />
				<div className="fm-sheet__head">
					<h2 className="fm-h3">{title}</h2>
					<button type="button" className="fm-iconbtn" onClick={onClose} aria-label="Close">
						<Icon name="close" size={20} />
					</button>
				</div>
				{children}
			</div>
		</div>
	);
};

export default Dialog;
