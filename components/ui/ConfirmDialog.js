import React, { useEffect, useRef } from "react";

// Accessible confirmation dialog: role="alertdialog", focus moves into it, Tab is kept inside, Escape and
// the backdrop cancel, and focus returns to the control that opened it.
const ConfirmDialog = ({ open, title, children, confirmLabel = "Confirm", cancelLabel = "Cancel", danger = false, busy = false, confirmDisabled = false, onConfirm, onCancel }) => {
	const boxRef = useRef(null);
	const opener = useRef(null);

	useEffect(() => {
		if (!open) return;
		opener.current = document.activeElement;
		const box = boxRef.current;
		const focusables = () => Array.from(box.querySelectorAll("button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled])"));
		// Land on the safe choice (Cancel) first.
		(focusables().find((el) => el.tagName === "BUTTON") || box).focus();
		const onKey = (e) => {
			if (e.key === "Escape") {
				e.preventDefault();
				onCancel();
			} else if (e.key === "Tab") {
				const f = focusables();
				if (!f.length) return;
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
		return () => {
			document.removeEventListener("keydown", onKey);
			if (opener.current && opener.current.focus) opener.current.focus();
		};
	}, [open, onCancel]);

	if (!open) return null;
	return (
		<div className="ss-confirm" onMouseDown={(e) => e.target === e.currentTarget && onCancel()}>
			<div ref={boxRef} className="ss-confirm__box" role="alertdialog" aria-modal="true" aria-labelledby="ss-confirm-title" aria-describedby="ss-confirm-desc" tabIndex={-1}>
				<h2 id="ss-confirm-title">{title}</h2>
				<div id="ss-confirm-desc">{children}</div>
				<div className="ss-confirm__actions">
					<button type="button" className="ss-btn ss-btn--secondary" onClick={onCancel} disabled={busy}>
						{cancelLabel}
					</button>
					<button type="button" className={`ss-btn${danger ? " ss-btn--danger" : ""}`} onClick={onConfirm} disabled={busy || confirmDisabled} aria-busy={busy ? true : undefined}>
						{busy ? "Working…" : confirmLabel}
					</button>
				</div>
			</div>
		</div>
	);
};

export default ConfirmDialog;
