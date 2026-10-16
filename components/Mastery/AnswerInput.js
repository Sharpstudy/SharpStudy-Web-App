// Answer entry for one problem: a text field (with on-screen keypad for
// number-like answers), lettered choice buttons, or one field per part.
import React, { useEffect, useRef } from "react";

const KEYPAD_TYPES = ["integer", "decimal", "fraction"];

export const Keypad = ({ onKey, onSubmit, allowDecimal, allowFraction, allowMinus = true, disabled }) => {
	const keys = ["7", "8", "9", "4", "5", "6", "1", "2", "3"];
	return (
		<div className="ml-keypad" role="group" aria-label="Number keypad">
			{keys.map((k) => (
				<button key={k} type="button" className="ml-key" onClick={() => onKey(k)} disabled={disabled}>
					{k}
				</button>
			))}
			<button type="button" className="ml-key" onClick={() => onKey("-")} disabled={disabled || !allowMinus} aria-label="minus sign">
				−
			</button>
			<button type="button" className="ml-key" onClick={() => onKey("0")} disabled={disabled}>
				0
			</button>
			{allowFraction ? (
				<button type="button" className="ml-key" onClick={() => onKey("/")} disabled={disabled} aria-label="fraction bar">
					/
				</button>
			) : (
				<button type="button" className="ml-key" onClick={() => onKey(".")} disabled={disabled || !allowDecimal} aria-label="decimal point">
					.
				</button>
			)}
			<button type="button" className="ml-key ml-key--muted" onClick={() => onKey("back")} disabled={disabled} aria-label="Delete last character">
				<i className="ri-delete-back-2-line" aria-hidden="true"></i>
			</button>
			{allowFraction && (
				<button type="button" className="ml-key" onClick={() => onKey(" ")} disabled={disabled} aria-label="space, for mixed numbers">
					␣
				</button>
			)}
			<button type="button" className="ml-key ml-key--go" onClick={onSubmit} disabled={disabled}>
				Check
			</button>
		</div>
	);
};

// value: string (scalar) or string[] (multi)
const AnswerInput = ({ problem, value, onChange, onSubmit, disabled, status, autoFocus = true }) => {
	const firstRef = useRef(null);

	useEffect(() => {
		if (autoFocus && firstRef.current && !disabled) firstRef.current.focus();
	}, [problem, autoFocus, disabled]);

	if (problem.type === "choice") {
		return (
			<div className="ml-choices" role="radiogroup" aria-label="Choose an answer">
				{problem.choices.map((c, i) => (
					<button
						key={c.label}
						ref={i === 0 ? firstRef : undefined}
						type="button"
						role="radio"
						aria-checked={value === c.label}
						className={`ml-choice${value === c.label ? " is-selected" : ""}`}
						disabled={disabled}
						onClick={() => {
							onChange(c.label);
							onSubmit(c.label);
						}}
					>
						<span className="ml-choice__letter" aria-hidden="true">
							{c.label}
						</span>
						<span>{c.text}</span>
					</button>
				))}
			</div>
		);
	}

	const onEnter = (e) => {
		if (e.key === "Enter") {
			e.preventDefault();
			onSubmit();
		}
	};

	if (problem.type === "multi") {
		const vals = Array.isArray(value) ? value : problem.inputs.map(() => "");
		return (
			<div className="ml-multi">
				{problem.inputs.map((inp, i) => (
					<label key={i} className="ml-multi__field">
						<span>{inp.label}</span>
						<input
							ref={i === 0 ? firstRef : undefined}
							className={`ml-input ml-input--sm${status === "wrong" ? " is-wrong" : ""}`}
							inputMode="text"
							autoComplete="off"
							value={vals[i] || ""}
							disabled={disabled}
							onKeyDown={onEnter}
							onChange={(e) => {
								const next = vals.slice();
								next[i] = e.target.value;
								onChange(next);
							}}
						/>
					</label>
				))}
				<button type="button" className="ss-btn ml-check" onClick={() => onSubmit()} disabled={disabled}>
					Check
				</button>
			</div>
		);
	}

	const numeric = KEYPAD_TYPES.includes(problem.type);
	const str = typeof value === "string" ? value : "";
	const onKey = (k) => {
		if (k === "back") onChange(str.slice(0, -1));
		else if (str.length < 24) onChange(str + k);
	};
	return (
		<div className="ml-answer">
			<div className="ml-answer__row">
				<label className="ss-sr-only" htmlFor="ml-answer-input">
					Your answer
				</label>
				<input
					id="ml-answer-input"
					ref={firstRef}
					className={`ml-input${status === "wrong" ? " is-wrong" : ""}${status === "right" ? " is-right" : ""}`}
					inputMode={problem.type === "integer" ? "numeric" : problem.type === "decimal" ? "decimal" : "text"}
					autoComplete="off"
					autoCapitalize="off"
					spellCheck={false}
					value={str}
					disabled={disabled}
					onKeyDown={onEnter}
					onChange={(e) => onChange(e.target.value)}
					placeholder={problem.type === "fraction" ? "e.g. 3/4" : problem.type === "expression" ? "e.g. 3x + 2" : ""}
				/>
				{problem.unit && <span className="ml-unit">{problem.unit}</span>}
			</div>
			{numeric ? (
				<Keypad
					onKey={onKey}
					onSubmit={() => onSubmit()}
					allowDecimal={problem.type === "decimal"}
					allowFraction={problem.type === "fraction"}
					disabled={disabled}
				/>
			) : (
				<button type="button" className="ss-btn ml-check" onClick={() => onSubmit()} disabled={disabled}>
					Check
				</button>
			)}
		</div>
	);
};

export default AnswerInput;
