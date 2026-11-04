// Original line icons for the family screens: child avatars, the nine secret pictures and the small
// UI glyphs. Drawn as inline SVG on a 24x24 grid (stroke 2, round caps) so they scale and recolour
// with CSS and need no network. Colours follow the reference design.
import React from "react";

const Svg = ({ children, size = 24, className, label, strokeWidth = 2 }) => (
	<svg
		className={className}
		width={size}
		height={size}
		viewBox="0 0 24 24"
		fill="none"
		stroke="currentColor"
		strokeWidth={strokeWidth}
		strokeLinecap="round"
		strokeLinejoin="round"
		role={label ? "img" : undefined}
		aria-label={label}
		aria-hidden={label ? undefined : true}
		focusable="false"
	>
		{children}
	</svg>
);

const SHAPES = {
	rocket: (
		<>
			<path d="M12 3c3 2 4.4 5 4.4 8.5L18 16l-3 1H9l-3-1 1.6-4.5C7.6 8 9 5 12 3z" />
			<circle cx="12" cy="10" r="1.6" />
			<path d="M9 17.5l-1.6 3M15 17.5l1.6 3" />
		</>
	),
	leaf: (
		<>
			<path d="M5 19C5 10 10 5 19 5c0 9-5 14-14 14z" />
			<path d="M5 19l8-8" />
		</>
	),
	star: <path d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.9L12 16.9l-5.2 2.8 1-5.9L3.5 9.7l5.9-.8z" />,
	fish: (
		<>
			<path d="M3 12c3-4.5 8-5.5 12-3.5l5-2.5v12l-5-2.5C11 17.5 6 16.5 3 12z" />
			<circle cx="8.2" cy="11.4" r=".6" fill="currentColor" />
		</>
	),
	moon: <path d="M20 14.5A8 8 0 1 1 9.5 4 6.5 6.5 0 0 0 20 14.5z" />,
	flower: (
		<>
			<circle cx="12" cy="7.2" r="2.8" />
			<circle cx="12" cy="16.8" r="2.8" />
			<circle cx="7.2" cy="12" r="2.8" />
			<circle cx="16.8" cy="12" r="2.8" />
		</>
	),
	sun: (
		<>
			<circle cx="12" cy="12" r="3.6" />
			<path d="M12 3v2.4M12 18.6V21M3 12h2.4M18.6 12H21M5.6 5.6l1.7 1.7M16.7 16.7l1.7 1.7M5.6 18.4l1.7-1.7M16.7 7.3l1.7-1.7" />
		</>
	),
	heart: <path d="M12 20s-7.5-4.6-7.5-10A4.2 4.2 0 0 1 12 7.6 4.2 4.2 0 0 1 19.5 10c0 5.4-7.5 10-7.5 10z" />,
	cloud: <path d="M7 18a4 4 0 0 1-.6-7.9A5.5 5.5 0 0 1 17 8.6 4.7 4.7 0 0 1 17.5 18z" />,
	ball: (
		<>
			<circle cx="12" cy="12" r="8.2" />
			<path d="M12 3.8v16.4M3.8 12h16.4" />
		</>
	),
};

export const Glyph = ({ name, ...p }) => <Svg {...p}>{SHAPES[name] || null}</Svg>;

// ----- avatars: stored in ml_learners.avatar as an emoji (older profiles keep theirs) -----
const AVATAR = {
	"🚀": { glyph: "rocket", bg: "#8ec5fe", name: "Rocket" },
	"🌿": { glyph: "leaf", bg: "#7ed6b0", name: "Leaf" },
	"⭐": { glyph: "star", bg: "#ffc83d", name: "Star" },
	"🐟": { glyph: "fish", bg: "#fdb6a1", name: "Fish" },
	"🌙": { glyph: "moon", bg: "#cbb7fe", name: "Moon" },
	"🌸": { glyph: "flower", bg: "#fdd1e6", name: "Flower" },
};
export const AVATAR_CHOICES = Object.entries(AVATAR).map(([key, v]) => ({ key, ...v }));

export const Avatar = ({ avatar, size = 48, ring = false, className = "" }) => {
	const a = AVATAR[avatar];
	return (
		<span
			className={`fm-avatar ${ring ? "fm-avatar--ring" : ""} ${className}`}
			style={{ width: size, height: size, background: a ? a.bg : "#8ec5fe", fontSize: size * 0.5 }}
			aria-hidden="true"
		>
			{a ? <Glyph name={a.glyph} size={Math.round(size * 0.5)} /> : <span>{avatar || "🙂"}</span>}
		</span>
	);
};

// ----- the nine secret pictures -----
export const PICTURE_STYLE = {
	sun: { color: "#d79a00", name: "Sun" },
	star: { color: "#2e47c8", name: "Star" },
	heart: { color: "#c4411f", name: "Heart" },
	moon: { color: "#6d44d6", name: "Moon" },
	leaf: { color: "#1f7a4c", name: "Leaf" },
	fish: { color: "#1c78b0", name: "Fish" },
	cloud: { color: "#4b4a6a", name: "Cloud" },
	flower: { color: "#b02f78", name: "Flower" },
	ball: { color: "#c4411f", name: "Ball" },
};
export const PICTURE_ORDER = ["sun", "star", "heart", "moon", "leaf", "fish", "cloud", "flower", "ball"];

export const Picture = ({ id, size = 40 }) => (
	<span style={{ color: PICTURE_STYLE[id].color, display: "inline-flex" }}>
		<Glyph name={id} size={size} />
	</span>
);

// ----- brand mark (blue tile with a yellow star; inverted on blue backgrounds) -----
export const AppMark = ({ size = 44, inverted = false }) => (
	<span className={`fm-mark ${inverted ? "fm-mark--inv" : ""}`} style={{ width: size, height: size }} aria-hidden="true">
		<Glyph name="star" size={Math.round(size * 0.5)} />
	</span>
);

// ----- small UI glyphs -----
const UI = {
	phone: (
		<>
			<rect x="7" y="2.5" width="10" height="19" rx="2.4" />
			<path d="M11 18.2h2" />
		</>
	),
	tablet: (
		<>
			<rect x="4.5" y="3" width="15" height="18" rx="2.4" />
			<path d="M10.5 18h3" />
		</>
	),
	laptop: (
		<>
			<rect x="4" y="5" width="16" height="11" rx="1.8" />
			<path d="M2.5 19.5h19" />
		</>
	),
	lock: (
		<>
			<rect x="5" y="10.5" width="14" height="10" rx="2.4" />
			<path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" />
		</>
	),
	back: <path d="M14.5 5l-7 7 7 7" />,
	chevron: <path d="M9.5 5l7 7-7 7" />,
	close: <path d="M6 6l12 12M18 6L6 18" />,
	plus: <path d="M12 5v14M5 12h14" />,
	check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
	backspace: (
		<>
			<path d="M9 5h10.5a1.5 1.5 0 0 1 1.5 1.5v11A1.5 1.5 0 0 1 19.5 19H9l-6-7z" />
			<path d="M12.5 9.5l5 5M17.5 9.5l-5 5" />
		</>
	),
	home: <path d="M4 11l8-7 8 7v9H4zM10 20v-6h4v6" />,
	search: (
		<>
			<circle cx="11" cy="11" r="6.5" />
			<path d="M16 16l4.5 4.5" />
		</>
	),
	chart: <path d="M5 20V10M12 20V4M19 20v-7" />,
	users: (
		<>
			<circle cx="9" cy="8.5" r="3.2" />
			<path d="M3 20c.4-3.4 2.8-5.2 6-5.2s5.6 1.8 6 5.2" />
			<circle cx="17.2" cy="9.5" r="2.4" />
			<path d="M17 14.6c2.4.2 3.7 1.7 4 4" />
		</>
	),
	userPlus: (
		<>
			<circle cx="9" cy="8.5" r="3.2" />
			<path d="M3 20c.4-3.4 2.8-5.2 6-5.2s5.6 1.8 6 5.2M19 8v6M16 11h6" />
		</>
	),
	qr: (
		<>
			<rect x="3.5" y="3.5" width="6" height="6" rx="1" />
			<rect x="14.5" y="3.5" width="6" height="6" rx="1" />
			<rect x="3.5" y="14.5" width="6" height="6" rx="1" />
			<path d="M14.5 14.5h2.5v2.5M20.5 14.5v0M14.5 20.5h2.5M20.5 17v3.5" />
		</>
	),
	alert: (
		<>
			<circle cx="12" cy="12" r="8.5" />
			<path d="M12 7.8v5M12 16.2v.1" />
		</>
	),
	refresh: <path d="M19 8a7.5 7.5 0 0 0-13-1.5L4.5 8.5M4.5 4v4.5H9M5 16a7.5 7.5 0 0 0 13 1.5l1.5-2M19.5 20v-4.5H15" />,
	money: (
		<>
			<circle cx="12" cy="12" r="8.5" />
			<path d="M14.6 9.2c-.5-.8-1.4-1.2-2.6-1.2-1.5 0-2.5.7-2.5 1.8s1 1.5 2.5 1.9 2.5.8 2.5 1.9-1 1.8-2.5 1.8c-1.2 0-2.1-.4-2.6-1.2M12 6.5V8M12 16v1.5" />
		</>
	),
	ruler: (
		<>
			<rect x="3" y="8" width="18" height="8" rx="1.6" />
			<path d="M7 8v3M11 8v4M15 8v3M19 8v2" />
		</>
	),
	pie: (
		<>
			<circle cx="12" cy="12" r="8.5" />
			<path d="M12 3.5V12l6 6" />
		</>
	),
	book: <path d="M5 4.5h10a3 3 0 0 1 3 3V20H8a3 3 0 0 1-3-3zM5 17a3 3 0 0 1 3-3h10" />,
	question: (
		<>
			<circle cx="12" cy="12" r="8.5" strokeDasharray="2 3.2" />
			<path d="M9.8 9.6a2.4 2.4 0 1 1 3.4 2.2c-.8.4-1.2.9-1.2 1.8M12 16.6v.1" />
		</>
	),
};
export const Icon = ({ name, ...p }) => <Svg {...p}>{UI[name] || null}</Svg>;
