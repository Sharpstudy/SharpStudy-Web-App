// 4-digit PIN entry: hardware keyboard or on-screen buttons. Calls
// onComplete(pin) once four digits are entered.
import React, { useEffect, useState } from "react";

const PinPad = ({ onComplete, disabled, error, label = "Enter your 4-digit PIN" }) => {
	const [pin, setPin] = useState("");

	useEffect(() => {
		if (error) setPin("");
	}, [error]);

	const push = (d) => {
		if (disabled || pin.length >= 4) return;
		const next = pin + d;
		setPin(next);
		if (next.length === 4) onComplete(next);
	};
	const back = () => setPin((p) => p.slice(0, -1));

	useEffect(() => {
		const onKey = (e) => {
			if (/^\d$/.test(e.key)) push(e.key);
			else if (e.key === "Backspace") back();
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	});

	return (
		<div className="ml-pin">
			<p id="ml-pin-label" className="ml-pin__label">
				{label}
			</p>
			<div className="ml-pin__dots" role="status" aria-live="polite" aria-labelledby="ml-pin-label">
				{[0, 1, 2, 3].map((i) => (
					<span key={i} className={`ml-pin__dot${i < pin.length ? " is-filled" : ""}`} aria-hidden="true" />
				))}
				<span className="ss-sr-only">{pin.length} of 4 digits entered</span>
			</div>
			{error && (
				<p className="ml-pin__error" role="alert">
					{error}
				</p>
			)}
			<div className="ml-keypad ml-keypad--pin" role="group" aria-label="PIN keypad">
				{["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
					<button key={d} type="button" className="ml-key" onClick={() => push(d)} disabled={disabled}>
						{d}
					</button>
				))}
				<span />
				<button type="button" className="ml-key" onClick={() => push("0")} disabled={disabled}>
					0
				</button>
				<button type="button" className="ml-key ml-key--muted" onClick={back} disabled={disabled} aria-label="Delete last digit">
					<i className="ri-delete-back-2-line" aria-hidden="true"></i>
				</button>
			</div>
		</div>
	);
};

export default PinPad;
