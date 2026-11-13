import React, { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { placeMenu } from "@/lib/ui/menuPosition";
import { claimMenu, releaseMenu } from "@/lib/ui/menuRegistry";

// Small click/keyboard "more actions" menu. items: [{ label, icon, href } |
// { label, icon, onClick, danger, disabled, hint }]
//
// The panel is rendered in a portal on <body> with position: fixed. Inside a table, Bootstrap's
// `.table-responsive { overflow-x: auto }` turns overflow-y into `auto` as well, so an absolutely positioned
// panel was clipped to the table box (and scrolled inside it). A fixed panel outside the table cannot be clipped
// and does not depend on any ancestor's overflow, transform or stacking context.
const ActionMenu = ({ label = "More actions", items }) => {
	const [open, setOpen] = useState(false);
	const [pos, setPos] = useState(null);
	const trigger = useRef(null);
	const panel = useRef(null);
	const menuId = useId();
	const close = useCallback((returnFocus = false) => {
		setOpen(false);
		setPos(null);
		if (returnFocus && trigger.current) trigger.current.focus();
	}, []);
	// one stable function per instance, so the registry can recognise it
	const closeRef = useRef(null);
	if (!closeRef.current) closeRef.current = () => close(false);

	const place = useCallback(() => {
		if (!trigger.current || !panel.current) return;
		const a = trigger.current.getBoundingClientRect();
		const p = panel.current;
		setPos(placeMenu({ anchor: a, size: { width: p.offsetWidth || 220, height: p.scrollHeight }, viewport: { width: window.innerWidth, height: window.innerHeight } }));
	}, []);

	// Opening this menu closes any other that is open.
	useEffect(() => {
		if (!open) return;
		const fn = closeRef.current;
		claimMenu(fn);
		return () => releaseMenu(fn);
	}, [open]);

	// Measure after the first (hidden) render.
	useLayoutEffect(() => {
		if (open) place();
	}, [open, place]);

	// Focus the first item once the menu is positioned.
	const positioned = Boolean(pos);
	useEffect(() => {
		if (open && positioned && panel.current && !panel.current.contains(document.activeElement)) {
			const first = panel.current.querySelector('[role="menuitem"]');
			if (first) first.focus({ preventScroll: true });
		}
	}, [open, positioned]);

	useEffect(() => {
		if (!open) return;
		const onDown = (e) => {
			if (panel.current && panel.current.contains(e.target)) return;
			if (trigger.current && trigger.current.contains(e.target)) return; // the trigger toggles on click
			close(false);
		};
		const onKey = (e) => {
			if (e.key === "Escape") {
				e.preventDefault();
				close(true);
			}
		};
		const onMove = () => place();
		document.addEventListener("pointerdown", onDown);
		document.addEventListener("keydown", onKey);
		window.addEventListener("resize", onMove);
		window.addEventListener("scroll", onMove, true); // capture: also fires for the table's own scroll
		return () => {
			document.removeEventListener("pointerdown", onDown);
			document.removeEventListener("keydown", onKey);
			window.removeEventListener("resize", onMove);
			window.removeEventListener("scroll", onMove, true);
		};
	}, [open, close, place]);

	const onPanelKey = (e) => {
		const els = Array.from(panel.current.querySelectorAll('[role="menuitem"]'));
		const i = els.indexOf(document.activeElement);
		let next = null;
		if (e.key === "ArrowDown") next = els[(i + 1) % els.length];
		else if (e.key === "ArrowUp") next = els[(i - 1 + els.length) % els.length];
		else if (e.key === "Home") next = els[0];
		else if (e.key === "End") next = els[els.length - 1];
		else if (e.key === "Tab") return close(false);
		if (next) {
			e.preventDefault();
			next.focus();
		}
	};

	const onTriggerKey = (e) => {
		if (e.key === "ArrowDown" && !open) {
			e.preventDefault();
			setOpen(true);
		}
	};

	// Nothing to offer: render no button rather than a button that opens an empty panel.
	if (!items || !items.length) return null;

	return (
		<div className="ss-menu ss-action-menu">
			<button
				ref={trigger}
				type="button"
				className="ss-btn ss-btn--secondary ss-btn--sm ss-btn--icon"
				aria-haspopup="menu"
				aria-expanded={open}
				aria-controls={open ? menuId : undefined}
				aria-label={label}
				onClick={() => (open ? close(false) : setOpen(true))}
				onKeyDown={onTriggerKey}
			>
				<i className="ri-more-2-fill" aria-hidden="true"></i>
			</button>
			{open &&
				typeof document !== "undefined" &&
				createPortal(
					<div
						ref={panel}
						id={menuId}
						className="ss-menu__panel ss-menu__panel--floating"
						role="menu"
						aria-label={label}
						onKeyDown={onPanelKey}
						// hidden until measured, so it never flashes at the wrong spot
						style={pos ? { top: pos.top, left: pos.left, width: pos.width, maxHeight: pos.maxHeight } : { top: 0, left: 0, visibility: "hidden" }}
						data-placement={pos ? pos.placement : undefined}
					>
						{items.map((it) =>
							it.href ? (
								<Link href={it.href} key={it.label}>
									<a className="ss-menu__item" role="menuitem" onClick={() => close(false)}>
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
									// a disabled item stays focusable (aria-disabled) so its reason can be read, but does nothing
									aria-disabled={it.disabled ? "true" : undefined}
									title={it.hint || undefined}
									onClick={() => {
										if (it.disabled) return;
										close(false);
										it.onClick();
									}}
								>
									<i className={it.icon} aria-hidden="true"></i>
									{it.label}
								</button>
							)
						)}
					</div>,
					document.body
				)}
		</div>
	);
};

export default ActionMenu;
