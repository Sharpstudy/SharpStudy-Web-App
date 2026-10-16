// 21-day habit grid: one cell per family-local day, filled when the daily
// goal was met, half-filled when some practice happened.
import React from "react";

const fmt = (d) =>
	new Date(`${d}T12:00:00Z`).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });

const HabitGrid = ({ days = [], goal = 1 }) => (
	<div className="ml-habit">
		<ol className="ml-habit__grid" aria-label={`Last ${days.length} days of practice`}>
			{days.map((d) => {
				const state = d.met ? "met" : d.worksheets > 0 ? "some" : "none";
				const text = `${fmt(d.date)}: ${d.worksheets} worksheet${d.worksheets === 1 ? "" : "s"}${d.met ? ", goal met" : ""}`;
				return (
					<li key={d.date} className={`ml-habit__cell is-${state}${d.isToday ? " is-today" : ""}`} title={text}>
						<span className="ss-sr-only">{text}</span>
					</li>
				);
			})}
		</ol>
		<p className="ml-habit__legend">
			<span className="ml-habit__swatch is-met" aria-hidden="true" /> Goal met ({goal}/day)
			<span className="ml-habit__swatch is-some" aria-hidden="true" /> Some practice
			<span className="ml-habit__swatch is-none" aria-hidden="true" /> None
		</p>
	</div>
);

export default HabitGrid;
