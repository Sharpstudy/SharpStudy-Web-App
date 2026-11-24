// Accessible SVG diagrams for questions. Every diagram has role="img" and a
// text label, so the question is answerable with a screen reader.
import React from "react";

const Dots = ({ count }) => {
	const perRow = 5;
	const rows = Math.ceil(count / perRow);
	const gap = 34;
	return (
		<svg viewBox={`0 0 ${perRow * gap + 10} ${rows * gap + 10}`} className="ml-scene__svg">
			{Array.from({ length: count }, (_, i) => (
				<circle key={i} cx={22 + (i % perRow) * gap} cy={22 + Math.floor(i / perRow) * gap} r="12" className="ml-fill-primary" />
			))}
		</svg>
	);
};

const TenFrame = ({ count }) => {
	const frames = Math.max(1, Math.ceil(count / 10));
	const cell = 36;
	return (
		<svg viewBox={`0 0 ${5 * cell + 4} ${frames * (2 * cell + 12)}`} className="ml-scene__svg">
			{Array.from({ length: frames }, (_, f) => (
				<g key={f} transform={`translate(2 ${f * (2 * cell + 12) + 2})`}>
					{Array.from({ length: 10 }, (_, i) => {
						const filled = f * 10 + i < count;
						const x = (i % 5) * cell;
						const y = Math.floor(i / 5) * cell;
						return (
							<g key={i}>
								<rect x={x} y={y} width={cell} height={cell} className="ml-cell" />
								{filled && <circle cx={x + cell / 2} cy={y + cell / 2} r={cell / 2 - 7} className="ml-fill-accent" />}
							</g>
						);
					})}
				</g>
			))}
		</svg>
	);
};

const Objects = ({ emoji, count }) => (
	<div className="ml-scene__objects" aria-hidden="true">
		{Array.from({ length: count }, (_, i) => (
			<span key={i}>{emoji}</span>
		))}
	</div>
);

const NumberLine = ({ from, to, marks = [] }) => {
	const n = to - from;
	const w = 320;
	const x = (v) => 12 + ((v - from) / n) * (w - 24);
	return (
		<svg viewBox={`0 0 ${w} 60`} className="ml-scene__svg">
			<line x1="8" y1="30" x2={w - 8} y2="30" className="ml-stroke" />
			{Array.from({ length: n + 1 }, (_, i) => (
				<g key={i}>
					<line x1={x(from + i)} y1="24" x2={x(from + i)} y2="36" className="ml-stroke" />
					<text x={x(from + i)} y="54" textAnchor="middle" className="ml-label">
						{from + i}
					</text>
				</g>
			))}
			{marks.map((m) => (
				<circle key={m} cx={x(m)} cy="30" r="6" className="ml-fill-accent" />
			))}
		</svg>
	);
};

const Circuit = ({ resistors = [], voltage }) => {
	const w = 80 + resistors.length * 90;
	return (
		<svg viewBox={`0 0 ${w} 130`} className="ml-scene__svg">
			<rect x="20" y="20" width={w - 40} height="90" fill="none" className="ml-stroke" />
			{/* cell on the left side */}
			<rect x="10" y="50" width="20" height="30" className="ml-bg" />
			<line x1="12" y1="58" x2="28" y2="58" className="ml-stroke ml-stroke--thick" />
			<line x1="16" y1="70" x2="24" y2="70" className="ml-stroke ml-stroke--thick" />
			{voltage !== undefined && (
				<text x="36" y="70" className="ml-label">
					{voltage} V
				</text>
			)}
			{resistors.map((r, i) => {
				const cx = 70 + i * 90;
				return (
					<g key={i}>
						<rect x={cx} y="10" width="50" height="20" className="ml-bg ml-stroke" />
						<text x={cx + 25} y="48" textAnchor="middle" className="ml-label">
							{r} Ω
						</text>
					</g>
				);
			})}
		</svg>
	);
};

const Forces = ({ mass, forces = [] }) => (
	<svg viewBox="0 0 320 120" className="ml-scene__svg">
		<defs>
			<marker id="ml-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
				<path d="M0,0 L10,5 L0,10 z" className="ml-fill-primary" />
			</marker>
		</defs>
		<line x1="20" y1="100" x2="300" y2="100" className="ml-stroke" />
		<rect x="125" y="50" width="70" height="50" rx="4" className="ml-fill-soft ml-stroke" />
		{mass !== undefined && (
			<text x="160" y="80" textAnchor="middle" className="ml-label">
				{mass} kg
			</text>
		)}
		{forces.map((f, i) =>
			f.dir === "right" ? (
				<g key={i}>
					<line x1="195" y1="75" x2="285" y2="75" className="ml-stroke ml-stroke--thick" markerEnd="url(#ml-arrow)" />
					<text x="240" y="65" textAnchor="middle" className="ml-label">
						{f.value}
					</text>
				</g>
			) : (
				<g key={i}>
					<line x1="125" y1="75" x2="35" y2="75" className="ml-stroke ml-stroke--thick" markerEnd="url(#ml-arrow)" />
					<text x="80" y="65" textAnchor="middle" className="ml-label">
						{f.value}
					</text>
				</g>
			)
		)}
	</svg>
);

const Scene = ({ scene }) => {
	if (!scene) return null;
	let body = null;
	if (scene.kind === "dots") body = <Dots count={scene.count} />;
	else if (scene.kind === "tenframe") body = <TenFrame count={scene.count} />;
	else if (scene.kind === "objects") body = <Objects emoji={scene.emoji} count={scene.count} />;
	else if (scene.kind === "numberline") body = <NumberLine {...scene} />;
	else if (scene.kind === "circuit") body = <Circuit {...scene} />;
	else if (scene.kind === "forces") body = <Forces {...scene} />;
	if (!body) return null;
	return (
		<figure className="ml-scene" role="img" aria-label={scene.label || "Diagram"}>
			{body}
		</figure>
	);
};

export default Scene;
