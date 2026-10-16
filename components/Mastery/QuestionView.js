// Renders a Mastery Ladder problem: rich-text prompt, optional diagram and
// optional column-arithmetic layout. Input controls live in AnswerInput.
import React from "react";
import Scene from "./Scene";

export const RichText = ({ value }) => (
	<>
		{(value || []).map((seg, i) => {
			if (typeof seg === "string") return <React.Fragment key={i}>{seg}</React.Fragment>;
			if (seg.frac)
				return (
					<span key={i} className="ml-frac" aria-label={`${seg.frac[0]} over ${seg.frac[1]}`}>
						<span className="ml-frac__n" aria-hidden="true">{seg.frac[0]}</span>
						<span className="ml-frac__d" aria-hidden="true">{seg.frac[1]}</span>
					</span>
				);
			if (seg.sup)
				return (
					<span key={i}>
						{seg.sup[0]}
						<sup>{seg.sup[1]}</sup>
					</span>
				);
			if (seg.blank)
				return (
					<span key={i} className="ml-blank" aria-label="blank">
						&nbsp;
					</span>
				);
			return null;
		})}
	</>
);

export const VerticalSum = ({ layout, answerLine = true }) => {
	const width = Math.max(String(layout.top).length, String(layout.bottom).length) + 1;
	return (
		<div className="ml-vertical" role="img" aria-label={`${layout.top} ${layout.op === "−" ? "minus" : layout.op === "×" ? "times" : "plus"} ${layout.bottom}, written in columns`} style={{ "--cols": width }}>
			<span className="ml-vertical__row" aria-hidden="true">{String(layout.top).padStart(width, " ")}</span>
			<span className="ml-vertical__row" aria-hidden="true">
				<span className="ml-vertical__op">{layout.op}</span>
				{String(layout.bottom).padStart(width - 1, " ")}
			</span>
			{answerLine && <span className="ml-vertical__line" aria-hidden="true" />}
		</div>
	);
};

const QuestionView = ({ problem, number, total, compact }) => (
	<div className={`ml-question${compact ? " ml-question--compact" : ""}`}>
		{number && (
			<p className="ml-question__count">
				Question {number}
				{total ? ` of ${total}` : ""}
			</p>
		)}
		{problem.scene && <Scene scene={problem.scene} />}
		{problem.layout && problem.layout.kind === "vertical" ? (
			<VerticalSum layout={problem.layout} />
		) : (
			<p className="ml-question__prompt" aria-label={problem.text}>
				<span aria-hidden="true">
					<RichText value={problem.prompt} />
				</span>
			</p>
		)}
		{problem.layout && <p className="ss-sr-only">{problem.text}</p>}
	</div>
);

export default QuestionView;
