import React, { useEffect, useRef, useState } from "react";
import Link from "next/link";

// Small click/keyboard "more actions" menu. items: [{ label, icon, href } |
// { label, icon, onClick, danger }]
const ActionMenu = ({ label = "More actions", items }) => {
	const [open, setOpen] = useState(false);
	const ref = useRef(null);

	useEffect(() => {
		if (!open) return;
		const onDown = (e) => ref.current && !ref.current.contains(e.target) && setOpen(false);
		const onKey = (e) => e.key === "Escape" && setOpen(false);
		document.addEventListener("mousedown", onDown);
		document.addEventListener("keydown", onKey);
		return () => {
			document.removeEventListener("mousedown", onDown);
			document.removeEventListener("keydown", onKey);
		};
	}, [open]);

	return (
		<div className="ss-menu ss-action-menu" ref={ref}>
			<button
				type="button"
				className="ss-btn ss-btn--secondary ss-btn--sm ss-btn--icon"
				aria-haspopup="menu"
				aria-expanded={open}
				aria-label={label}
				onClick={() => setOpen((o) => !o)}
			>
				<i className="ri-more-2-fill" aria-hidden="true"></i>
			</button>
			{open && (
				<div className="ss-menu__panel" role="menu">
					{items.map((it) =>
						it.href ? (
							<Link href={it.href} key={it.label}>
								<a className="ss-menu__item" role="menuitem">
									<i className={it.icon} aria-hidden="true"></i>
									{it.label}
								</a>
							</Link>
						) : (
							<button
								key={it.label}
								type="button"
								role="menuitem"
								className={`ss-menu__item${it.danger ? " is-danger" : ""}`}
								onClick={() => {
									setOpen(false);
									it.onClick();
								}}
							>
								<i className={it.icon} aria-hidden="true"></i>
								{it.label}
							</button>
						)
					)}
				</div>
			)}
		</div>
	);
};

export default ActionMenu;
