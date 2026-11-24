// Worksheets completed per day / week / month. Single series, so one hue
// (--ss-primary, validated against the light surface) and no legend: the
// title names the series. Hover/focus tooltip per bar; table view toggle.
import React, { useState } from "react";

const PERIODS = [
	{ id: "day", label: "Day" },
	{ id: "week", label: "Week" },
	{ id: "month", label: "Month" },
];

const labelFor = (period, b) => {
	const d = new Date(`${b.start}T12:00:00Z`);
	if (period === "month") return d.toLocaleDateString(undefined, { month: "short", timeZone: "UTC" });
	if (period === "week") return d.toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });
	return d.toLocaleDateString(undefined, { weekday: "narrow", timeZone: "UTC" });
};
const longLabel = (period, b) => {
	const d = new Date(`${b.start}T12:00:00Z`);
	if (period === "month") return d.toLocaleDateString(undefined, { month: "long", year: "numeric", timeZone: "UTC" });
	if (period === "week") return `Week of ${d.toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" })}`;
	return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
};

const ActivityChart = ({ charts }) => {
	const [period, setPeriod] = useState("day");
	const [hover, setHover] = useState(null);
	const [table, setTable] = useState(false);
	const data = charts[period] || [];
	const max = Math.max(1, ...data.map((b) => b.worksheets));
	const niceMax = max <= 4 ? max : Math.ceil(max / 2) * 2;
	const W = 560;
	const H = 180;
	const pad = { l: 28, r: 8, t: 10, b: 26 };
	const slot = (W - pad.l - pad.r) / Math.max(1, data.length);
	const barW = Math.max(6, Math.min(28, slot - 2)); // >= 2px surface gap between bars
	const y = (v) => pad.t + (H - pad.t - pad.b) * (1 - v / niceMax);
	const ticks = [0, niceMax / 2, niceMax].filter((v, i, a) => Number.isInteger(v) && a.indexOf(v) === i);

	return (
		<figure className="ml-chart">
			<div className="ml-chart__head">
				<figcaption className="ml-h3">Worksheets completed</figcaption>
				<div className="ml-row">
					<div className="ml-segmented" role="group" aria-label="Time period">
						{PERIODS.map((p) => (
							<button key={p.id} type="button" aria-pressed={period === p.id} className={period === p.id ? "is-active" : ""} onClick={() => setPeriod(p.id)}>
								{p.label}
							</button>
						))}
					</div>
					<button type="button" className="ss-btn ss-btn--ghost ss-btn--sm" aria-pressed={table} onClick={() => setTable((t) => !t)}>
						{table ? "Chart" : "Table"}
					</button>
				</div>
			</div>
			{table ? (
				<div className="ss-table-wrap">
					<table className="ml-table">
						<thead>
							<tr>
								<th scope="col">{period === "day" ? "Day" : period === "week" ? "Week" : "Month"}</th>
								<th scope="col">Worksheets</th>
								<th scope="col">Stars</th>
								<th scope="col">Minutes</th>
							</tr>
						</thead>
						<tbody>
							{data.map((b) => (
								<tr key={b.start}>
									<td>{longLabel(period, b)}</td>
									<td>{b.worksheets}</td>
									<td>{b.stars}</td>
									<td>{Math.round(b.seconds / 60)}</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			) : (
				<div className="ml-chart__plot" onMouseLeave={() => setHover(null)}>
					<svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Bar chart of worksheets completed per ${period}. Use the Table button for exact values.`}>
						{ticks.map((t) => (
							<g key={t}>
								<line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} className="ml-chart__grid" />
								<text x={pad.l - 6} y={y(t) + 4} textAnchor="end" className="ml-chart__axis">
									{t}
								</text>
							</g>
						))}
						{data.map((b, i) => {
							const cx = pad.l + slot * i + slot / 2;
							const h = y(0) - y(b.worksheets);
							const r = Math.min(4, barW / 2, h);
							const x0 = cx - barW / 2;
							const top = y(b.worksheets);
							// Rounded data-end (top), square at the baseline.
							const path =
								h > 0
									? `M${x0},${y(0)} V${top + r} Q${x0},${top} ${x0 + r},${top} H${x0 + barW - r} Q${x0 + barW},${top} ${x0 + barW},${top + r} V${y(0)} Z`
									: null;
							const showLabel = period !== "day" || i % 2 === data.length % 2 || data.length <= 8;
							return (
								<g key={b.start}>
									{path && <path d={path} className={`ml-chart__bar${hover === i ? " is-hover" : ""}`} />}
									{/* Hit target wider and taller than the bar */}
									<rect
										x={pad.l + slot * i}
										y={pad.t}
										width={slot}
										height={H - pad.t - pad.b}
										fill="transparent"
										tabIndex={0}
										aria-label={`${longLabel(period, b)}: ${b.worksheets} worksheets`}
										onMouseEnter={() => setHover(i)}
										onFocus={() => setHover(i)}
										onBlur={() => setHover(null)}
									/>
									{showLabel && (
										<text x={cx} y={H - 8} textAnchor="middle" className="ml-chart__axis">
											{labelFor(period, b)}
										</text>
									)}
								</g>
							);
						})}
						<line x1={pad.l} x2={W - pad.r} y1={y(0)} y2={y(0)} className="ml-chart__baseline" />
					</svg>
					{hover !== null && data[hover] && (
						<div className="ml-chart__tip" style={{ left: `${((pad.l + slot * hover + slot / 2) / W) * 100}%` }} role="status">
							<strong>{longLabel(period, data[hover])}</strong>
							<span>
								{data[hover].worksheets} worksheet{data[hover].worksheets === 1 ? "" : "s"} · {data[hover].stars}★ · {Math.round(data[hover].seconds / 60)} min
							</span>
						</div>
					)}
				</div>
			)}
		</figure>
	);
};

export default ActivityChart;
