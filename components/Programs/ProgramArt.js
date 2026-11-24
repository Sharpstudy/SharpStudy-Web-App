import React from "react";

// Original line illustrations for the four programs (no third-party art). Decorative: aria-hidden, no text, no network requests.
const INK = "#26235f";
const T = {
	pink: { soft: "#fddde8", strong: "#f9afc8" },
	sky: { soft: "#d7ecfc", strong: "#1faeeb" },
	orange: { soft: "#fdf0c4", strong: "#ffb52e" },
	green: { soft: "#e1f3d2", strong: "#7cc242" },
};
const line = { stroke: INK, strokeWidth: 3, strokeLinecap: "round", strokeLinejoin: "round" };

const Scenes = {
	// A heart with growing sprout: self-awareness and growth.
	"personality-enrichment": (c) => (
		<g>
			<circle cx="140" cy="120" r="92" fill={c.soft} />
			<path d="M140 190s-52-34-52-76a28 28 0 0 1 52-14 28 28 0 0 1 52 14c0 42-52 76-52 76z" fill={c.strong} {...line} />
			<path d="M140 100v36M140 118c-14-2-22-10-24-22 14 0 22 8 24 22zM140 118c14-2 22-10 24-22-14 0-22 8-24 22z" fill="#fff" {...line} />
			<path d="M52 60l6 14 15 2-11 10 3 15-13-8-13 8 3-15-11-10 15-2z" fill="#ffb52e" {...line} />
		</g>
	),
	// A calculator with number tiles: MathX.
	mathx: (c) => (
		<g>
			<circle cx="140" cy="120" r="92" fill={c.soft} />
			<rect x="92" y="54" width="96" height="132" rx="16" fill="#fff" {...line} />
			<rect x="104" y="66" width="72" height="26" rx="6" fill={c.strong} {...line} />
			{[0, 1, 2].map((r) =>
				[0, 1, 2].map((k) => <rect key={`${r}${k}`} x={104 + k * 26} y={102 + r * 26} width="20" height="18" rx="5" fill={(r + k) % 2 ? "#fdf0c4" : "#e1f3d2"} {...line} strokeWidth="2.5" />)
			)}
			<path d="M214 70l8 0M218 66v8M60 150h14M60 156h14" {...line} />
		</g>
	),
	// A flag on a hill with steps: Leadership.
	leadership: (c) => (
		<g>
			<circle cx="140" cy="120" r="92" fill={c.soft} />
			<path d="M60 180c20-34 40-52 80-52s60 18 80 52z" fill="#e1f3d2" {...line} />
			<path d="M140 128V50" {...line} />
			<path d="M140 52l56 16-56 22z" fill={c.strong} {...line} />
			<circle cx="92" cy="156" r="9" fill="#d7ecfc" {...line} />
			<circle cx="190" cy="158" r="9" fill="#fddde8" {...line} />
		</g>
	),
	// A microphone with sound waves: Public Speaking.
	"public-speaking": (c) => (
		<g>
			<circle cx="140" cy="120" r="92" fill={c.soft} />
			<rect x="118" y="46" width="44" height="76" rx="22" fill={c.strong} {...line} />
			<path d="M96 106c0 28 20 46 44 46s44-18 44-46M140 152v30M118 184h44" {...line} fill="none" />
			<path d="M70 92c-8 10-8 24 0 34M210 92c8 10 8 24 0 34M52 78c-16 20-16 46 0 66M228 78c16 20 16 46 0 66" {...line} fill="none" opacity=".55" />
		</g>
	),
};

const ProgramArt = ({ slug, tone = "sky", className }) => {
	const colours = T[tone] || T.sky;
	const draw = Scenes[slug] || Scenes.mathx;
	return (
		<svg className={className} viewBox="0 0 280 240" fill="none" aria-hidden="true" focusable="false">
			{draw(colours)}
		</svg>
	);
};

export default ProgramArt;
