import React from "react";

// Original SharpStudy illustrations (simple geometric scenes drawn for this app, no third-party art).
// Decorative only: aria-hidden, no text, no external requests.
const C = { ink: "#25304a", peach: "#ff8a5b", peachSoft: "#fff0e8", sky: "#ddf3ff", skyStrong: "#3ba7e0", sun: "#fff1a8", sunStrong: "#f5b800", mint: "#ddf7e5", mintStrong: "#35b26b", lav: "#eee5ff", lavStrong: "#8b6bea", white: "#ffffff" };

const Book = ({ x, y, w, h, fill, band }) => (
	<g>
		<rect x={x} y={y} width={w} height={h} rx="8" fill={fill} stroke={C.ink} strokeWidth="3" />
		<rect x={x + 14} y={y} width="10" height={h} fill={band} opacity=".9" />
		<rect x={x + w - 26} y={y + h / 2 - 3} width="18" height="6" rx="3" fill={C.white} opacity=".8" />
	</g>
);

const starPoints = (x, y, r) =>
	Array.from({ length: 10 }, (_, i) => {
		const a = (Math.PI / 5) * i - Math.PI / 2;
		const rad = i % 2 ? r * 0.45 : r;
		return `${(x + rad * Math.cos(a)).toFixed(1)},${(y + rad * Math.sin(a)).toFixed(1)}`;
	}).join(" ");
const Star = ({ x, y, r = 10, fill = C.sunStrong }) => <polygon points={starPoints(x, y, r)} fill={fill} stroke={C.ink} strokeWidth="2.5" strokeLinejoin="round" />;

// Homepage hero: a stack of books, a rocket, a sun and clouds.
export const HeroScene = ({ className }) => (
	<svg className={className} viewBox="0 0 560 440" fill="none" aria-hidden="true" focusable="false">
		<ellipse cx="280" cy="230" rx="250" ry="190" fill={C.sky} />
		<circle cx="440" cy="92" r="46" fill={C.sun} stroke={C.ink} strokeWidth="3" />
		<g stroke={C.ink} strokeWidth="3" strokeLinecap="round">
			<path d="M440 24v-14M440 174v14M372 92h-14M508 92h14M392 44l-10-10M488 140l10 10M392 140l-10 10M488 44l10-10" stroke={C.sunStrong} />
		</g>
		<path d="M70 150c0-18 14-30 32-30 6-18 34-22 46-6 22-2 38 14 36 32z" fill={C.white} stroke={C.ink} strokeWidth="3" strokeLinejoin="round" />
		<path d="M360 300c0-14 11-24 25-24 5-14 27-17 36-5 17-1 30 11 28 25z" fill={C.white} stroke={C.ink} strokeWidth="3" strokeLinejoin="round" />
		{/* ground */}
		<ellipse cx="280" cy="392" rx="200" ry="22" fill={C.mint} stroke={C.ink} strokeWidth="3" />
		{/* book stack */}
		<Book x={150} y={330} w={230} h={52} fill={C.peach} band={C.peachSoft} />
		<Book x={170} y={282} w={200} h={50} fill={C.lavStrong} band={C.lav} />
		<Book x={140} y={236} w={220} h={48} fill={C.skyStrong} band={C.sky} />
		{/* open book on top */}
		<path d="M190 236c26-26 56-28 90-8 34-20 64-18 90 8v-52c-26-24-56-24-90-6-34-18-64-18-90 6z" fill={C.white} stroke={C.ink} strokeWidth="3" strokeLinejoin="round" />
		<path d="M280 228V170" stroke={C.ink} strokeWidth="3" />
		<path d="M208 196c18-10 36-10 56 0M208 212c18-10 36-10 56 0M296 196c20-10 38-10 56 0M296 212c20-10 38-10 56 0" stroke={C.skyStrong} strokeWidth="3" strokeLinecap="round" />
		{/* rocket */}
		<g transform="rotate(24 468 250)">
			<path d="M468 168c22 26 28 62 22 98h-44c-6-36 0-72 22-98z" fill={C.white} stroke={C.ink} strokeWidth="3" strokeLinejoin="round" />
			<circle cx="468" cy="214" r="13" fill={C.sky} stroke={C.ink} strokeWidth="3" />
			<path d="M446 244l-20 24 20 2zM490 244l20 24-20 2z" fill={C.peach} stroke={C.ink} strokeWidth="3" strokeLinejoin="round" />
			<path d="M456 266h24l-12 36z" fill={C.sunStrong} stroke={C.ink} strokeWidth="3" strokeLinejoin="round" />
		</g>
		<Star x={96} y={290} r={16} />
		<Star x={520} y={330} r={12} fill={C.lavStrong} />
		<Star x={250} y={96} r={12} fill={C.peach} />
		<circle cx="330" cy="76" r="5" fill={C.mintStrong} />
		<circle cx="60" cy="230" r="6" fill={C.lavStrong} />
	</svg>
);

// Sign-in / registration side panel: an open book with stars.
export const AuthArt = ({ className }) => (
	<svg className={className} viewBox="0 0 360 260" fill="none" aria-hidden="true" focusable="false">
		<ellipse cx="180" cy="140" rx="165" ry="110" fill={C.lav} />
		<path d="M70 170c40-40 76-40 110-10 34-30 70-30 110 10V80c-40-34-76-34-110-6-34-28-70-28-110 6z" fill={C.white} stroke={C.ink} strokeWidth="3.5" strokeLinejoin="round" />
		<path d="M180 160V74" stroke={C.ink} strokeWidth="3.5" />
		<path d="M96 104c24-12 50-12 68 0M96 126c24-12 50-12 68 0M196 104c18-12 44-12 68 0M196 126c18-12 44-12 68 0" stroke={C.lavStrong} strokeWidth="3.5" strokeLinecap="round" />
		<Star x={70} y={56} r={16} />
		<Star x={300} y={48} r={13} fill={C.peach} />
		<Star x={312} y={196} r={11} fill={C.mintStrong} />
		<circle cx="52" cy="190" r="7" fill={C.skyStrong} />
		<circle cx="236" cy="30" r="5" fill={C.lavStrong} />
	</svg>
);

// Empty and error states: a friendly closed book.
export const EmptyArt = ({ className }) => (
	<svg className={className} viewBox="0 0 160 130" fill="none" aria-hidden="true" focusable="false">
		<ellipse cx="80" cy="112" rx="58" ry="9" fill={C.sky} />
		<rect x="38" y="30" width="84" height="78" rx="10" fill={C.sunStrong} stroke={C.ink} strokeWidth="3.5" />
		<rect x="50" y="30" width="10" height="78" fill={C.sun} />
		<rect x="70" y="52" width="40" height="7" rx="3.5" fill={C.white} />
		<rect x="70" y="68" width="28" height="7" rx="3.5" fill={C.white} opacity=".8" />
		<Star x={124} y={26} r={11} fill={C.peach} />
		<circle cx="30" cy="48" r="5" fill={C.lavStrong} />
	</svg>
);
