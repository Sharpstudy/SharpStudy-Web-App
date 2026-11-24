// Reusable controls for the family screens: PIN keypad, six-box code entry, QR code, countdown.
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "./art";

export const PIN_MIN = 4;
export const PIN_MAX = 6;

// ---------------------------------------------------------------- PIN keypad
// Controlled: value is a string of digits. Works with the on-screen keys and a hardware keyboard.
// theme "light" = the parent's Set-PIN screen, "dark" = the child device's Grown-ups-only screen.
export const PinPad = ({ value, onChange, onSubmit, theme = "light", disabled = false, minLength = PIN_MIN, maxLength = PIN_MAX }) => {
	const valueRef = useRef(value);
	valueRef.current = value;

	useEffect(() => {
		const onKey = (e) => {
			if (disabled || e.ctrlKey || e.metaKey || e.altKey) return;
			const t = e.target;
			if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
			if (/^\d$/.test(e.key)) {
				if (valueRef.current.length < maxLength) onChange(valueRef.current + e.key);
			} else if (e.key === "Backspace") {
				onChange(valueRef.current.slice(0, -1));
			} else if (e.key === "Enter" && valueRef.current.length >= minLength && onSubmit) {
				onSubmit();
			}
		};
		document.addEventListener("keydown", onKey);
		return () => document.removeEventListener("keydown", onKey);
	}, [disabled, maxLength, minLength, onChange, onSubmit]);

	const push = (d) => !disabled && value.length < maxLength && onChange(value + d);
	// Light theme shows the full 6-slot range (4 to 6 digits); dark shows 4 and grows with the entry.
	const slots = theme === "light" ? PIN_MAX : Math.max(PIN_MIN, value.length);

	return (
		<div className={`fm-pin fm-pin--${theme}`}>
			<div className="fm-pin__dots" role="status" aria-live="polite" aria-label={`${value.length} digit${value.length === 1 ? "" : "s"} entered`}>
				{Array.from({ length: slots }, (_, i) => (
					<span key={i} className={`fm-pin__dot ${i < value.length ? "is-on" : i >= PIN_MIN && theme === "light" ? "is-opt" : ""}`} />
				))}
			</div>
			<div className="fm-pin__keys">
				{[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => (
					<button key={n} type="button" className="fm-pin__key" disabled={disabled} onClick={() => push(String(n))} aria-label={String(n)}>
						{n}
					</button>
				))}
				<span />
				<button type="button" className="fm-pin__key" disabled={disabled} onClick={() => push("0")} aria-label="0">
					0
				</button>
				<button type="button" className="fm-pin__key fm-pin__key--ghost" disabled={disabled || !value.length} onClick={() => onChange(value.slice(0, -1))} aria-label="Delete last digit">
					<Icon name="backspace" size={26} />
				</button>
			</div>
		</div>
	);
};

// ---------------------------------------------------------------- code entry
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const cleanCodeInput = (s) =>
	String(s || "")
		.toUpperCase()
		.split("")
		.filter((c) => ALPHABET.includes(c))
		.join("")
		.slice(0, 6);

// One real <input> (so mobile keyboards, paste and screen readers work) drawn as six boxes.
export const CodeBoxes = ({ value, onChange, onEnter, disabled, autoFocus, invalid, id = "fm-code" }) => {
	const ref = useRef(null);
	const [focus, setFocus] = useState(false);
	useEffect(() => {
		if (autoFocus && ref.current) ref.current.focus();
	}, [autoFocus]);
	return (
		<div className={`fm-code ${invalid ? "is-invalid" : ""}`} onClick={() => ref.current && ref.current.focus()}>
			<div className="fm-code__boxes" aria-hidden="true">
				{Array.from({ length: 6 }, (_, i) => {
					const on = focus && i === Math.min(value.length, 5);
					return (
						<span key={i} className={`fm-code__box ${value[i] ? "is-full" : ""} ${on ? "is-active" : ""}`}>
							{value[i] || (on ? <span className="fm-code__caret" /> : null)}
						</span>
					);
				})}
			</div>
			<input
				ref={ref}
				id={id}
				className="fm-code__input"
				value={value}
				disabled={disabled}
				onChange={(e) => onChange(cleanCodeInput(e.target.value))}
				onFocus={() => setFocus(true)}
				onBlur={() => setFocus(false)}
				onKeyDown={(e) => e.key === "Enter" && onEnter && onEnter()}
				autoComplete="off"
				autoCorrect="off"
				autoCapitalize="characters"
				spellCheck={false}
				inputMode="text"
				maxLength={12}
				aria-label="Secret code, 6 letters and numbers"
			/>
		</div>
	);
};

// ---------------------------------------------------------------- QR code
export const QrCode = ({ value, size = 190, label = "QR code to pair a device" }) => {
	const [svg, setSvg] = useState(null);
	useEffect(() => {
		let alive = true;
		import("qrcode")
			.then((m) => (m.default || m).toString(value, { type: "svg", margin: 0, errorCorrectionLevel: "M", color: { dark: "#1b1f3b", light: "#0000" } }))
			.then((s) => alive && setSvg(s))
			.catch(() => alive && setSvg(null));
		return () => {
			alive = false;
		};
	}, [value]);
	return (
		<div className="fm-qr" style={{ width: size, height: size }} role="img" aria-label={label}>
			{svg ? <span className="fm-qr__svg" dangerouslySetInnerHTML={{ __html: svg }} /> : <span className="fm-qr__wait" />}
		</div>
	);
};

// ---------------------------------------------------------------- countdown
export const useCountdown = (expiresAt) => {
	const target = useMemo(() => (expiresAt ? new Date(expiresAt).getTime() : 0), [expiresAt]);
	const [left, setLeft] = useState(() => (target ? Math.max(0, Math.round((target - Date.now()) / 1000)) : 0));
	useEffect(() => {
		if (!target) return;
		const tick = () => setLeft(Math.max(0, Math.round((target - Date.now()) / 1000)));
		tick();
		const t = setInterval(tick, 1000);
		return () => clearInterval(t);
	}, [target]);
	return left;
};
export const mmss = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
