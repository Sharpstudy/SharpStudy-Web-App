// Where to put a floating menu (position: fixed, rendered in a portal) relative to its trigger button.
// All numbers are viewport pixels (getBoundingClientRect). Pure, so it can be tested without a browser.
//
// Rules: right-align to the trigger, then clamp inside the viewport; open below when it fits, otherwise
// above; if neither side fits, use the larger side and cap the height so the panel scrolls instead of
// running off screen.
export function placeMenu({ anchor, size, viewport, gap = 6, margin = 8 }) {
	const width = Math.min(size.width, Math.max(0, viewport.width - margin * 2));
	let left = anchor.right - width;
	left = Math.max(margin, Math.min(left, viewport.width - width - margin));

	const spaceBelow = viewport.height - anchor.bottom - gap - margin;
	const spaceAbove = anchor.top - gap - margin;
	let placement = "below";
	if (size.height > spaceBelow) placement = spaceAbove > spaceBelow ? "above" : "below";

	const room = placement === "below" ? spaceBelow : spaceAbove;
	const height = Math.min(size.height, Math.max(room, 0));
	const top = placement === "below" ? anchor.bottom + gap : anchor.top - gap - height;
	return { top: Math.max(margin, top), left, width, placement, maxHeight: Math.max(room, 0) };
}
