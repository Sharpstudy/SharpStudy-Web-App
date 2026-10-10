import React, { useId, useState } from "react";

// Labelled input with optional hint / error, wired up with aria attributes.
export const Field = ({ label, hint, error, id, className, children, ...inputProps }) => {
	const auto = useId();
	const inputId = id || `f-${auto}`;
	const hintId = hint ? `${inputId}-hint` : undefined;
	const errId = error ? `${inputId}-err` : undefined;
	const describedBy = [hintId, errId].filter(Boolean).join(" ") || undefined;
	return (
		<div className={`form-group ${className || ""}`}>
			<label className="form-label" htmlFor={inputId}>
				{label}
			</label>
			{children ? (
				React.cloneElement(children, { id: inputId, "aria-describedby": describedBy })
			) : (
				<input
					id={inputId}
					className={`form-control${error ? " is-invalid" : ""}`}
					aria-invalid={error ? true : undefined}
					aria-describedby={describedBy}
					{...inputProps}
				/>
			)}
			{hint && (
				<div id={hintId} className="form-text">
					{hint}
				</div>
			)}
			{error && (
				<div id={errId} className="ss-field-error" role="alert">
					{error}
				</div>
			)}
		</div>
	);
};

export const PasswordInput = ({ id, ...props }) => {
	const [show, setShow] = useState(false);
	return (
		<div className="ss-password">
			<input id={id} type={show ? "text" : "password"} className="form-control" {...props} />
			<button
				type="button"
				className="ss-password__toggle"
				onClick={() => setShow((s) => !s)}
				aria-label={show ? "Hide password" : "Show password"}
				aria-pressed={show}
			>
				<i className={show ? "ri-eye-off-line" : "ri-eye-line"} aria-hidden="true"></i>
			</button>
		</div>
	);
};
