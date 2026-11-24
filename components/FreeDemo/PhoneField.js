import React, { useEffect, useId, useMemo, useRef, useState } from "react";
import { cleanNational, findCountry, flagSrc, formatNational, searchCountries } from "@/lib/freeDemo/phone";

// International phone input: a country button (flag + calling code) that opens a searchable list, and a separate number box.
// Used inside <Field>, which passes `id` and `aria-describedby` for the number box. Keyboard: Enter/Space/ArrowDown on the button opens the
// list; type to search; ArrowUp/ArrowDown move; Enter chooses; Escape closes the list only (the dialog stays open); Tab closes it.
const PhoneInput = ({ id, country, national, onChange, invalid, "aria-describedby": describedBy }) => {
	const uid = useId();
	const listId = `ph-list-${uid}`;
	const [open, setOpen] = useState(false);
	const [q, setQ] = useState("");
	const [active, setActive] = useState(0);
	const root = useRef(null);
	const search = useRef(null);
	const button = useRef(null);
	const listRef = useRef(null);
	const current = findCountry(country);
	const results = useMemo(() => (open ? searchCountries(q) : []), [open, q]);

	useEffect(() => {
		if (!open) return undefined;
		const idx = Math.max(0, results.findIndex((c) => c.code === country));
		setActive(q ? 0 : idx);
		if (root.current && typeof window !== "undefined" && window.innerWidth < 768 && root.current.scrollIntoView) root.current.scrollIntoView({ block: "start" }); // phones: give the list the room
		if (search.current) search.current.focus({ preventScroll: true });
		const away = (e) => root.current && !root.current.contains(e.target) && setOpen(false);
		document.addEventListener("mousedown", away);
		document.addEventListener("touchstart", away);
		return () => {
			document.removeEventListener("mousedown", away);
			document.removeEventListener("touchstart", away);
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [open]);

	useEffect(() => {
		const el = listRef.current && listRef.current.querySelector(`[data-i="${active}"]`);
		if (el && el.scrollIntoView) el.scrollIntoView({ block: "nearest" });
	}, [active, open]);

	const close = (focusButton) => {
		setOpen(false);
		setQ("");
		if (focusButton && button.current) button.current.focus();
	};
	const choose = (c) => {
		onChange({ country: c.code, national: cleanNational(national, c.code) });
		close(true);
	};
	const stop = (e) => {
		e.preventDefault();
		e.stopPropagation();
		if (e.nativeEvent && e.nativeEvent.stopImmediatePropagation) e.nativeEvent.stopImmediatePropagation(); // keep the dialog's own Escape/Tab handler out of it
	};
	const onSearchKey = (e) => {
		if (e.key === "Escape") {
			stop(e);
			close(true);
		} else if (e.key === "ArrowDown") {
			e.preventDefault();
			setActive((i) => Math.min(results.length - 1, i + 1));
		} else if (e.key === "ArrowUp") {
			e.preventDefault();
			setActive((i) => Math.max(0, i - 1));
		} else if (e.key === "Home") {
			e.preventDefault();
			setActive(0);
		} else if (e.key === "End") {
			e.preventDefault();
			setActive(results.length - 1);
		} else if (e.key === "Enter") {
			e.preventDefault();
			if (results[active]) choose(results[active]);
		} else if (e.key === "Tab") {
			setOpen(false);
		}
	};
	const onButtonKey = (e) => {
		if (e.key === "ArrowDown" || e.key === "ArrowUp") {
			e.preventDefault();
			setOpen(true);
		}
	};

	return (
		<div className={`ss-phone${invalid ? " is-invalid" : ""}`} ref={root}>
			<button
				type="button"
				ref={button}
				className="ss-phone__country"
				aria-haspopup="listbox"
				aria-expanded={open}
				aria-controls={open ? listId : undefined}
				aria-label={`Country code: ${current.name}, plus ${current.dial}. Change country`}
				onClick={() => setOpen((o) => !o)}
				onKeyDown={onButtonKey}
			>
				<img src={flagSrc(current.code)} alt="" width="24" height="18" className="ss-phone__flag" />
				<span className="ss-phone__dial">+{current.dial}</span>
				<i className="ri-arrow-down-s-line" aria-hidden="true"></i>
			</button>
			<input
				id={id}
				name="phone"
				type="tel"
				inputMode="tel"
				autoComplete="tel-national"
				className={`form-control ss-phone__number${invalid ? " is-invalid" : ""}`}
				placeholder={current.code === "IN" ? "98765 43210" : "Phone number"}
				value={national}
				aria-invalid={invalid ? true : undefined}
				aria-describedby={describedBy}
				maxLength={24}
				onChange={(e) => onChange({ country, national: formatNational(cleanNational(e.target.value, country), country) })}
			/>
			{open && (
				<div className="ss-phone__pop">
					<input
						ref={search}
						type="search"
						className="form-control ss-phone__search"
						placeholder="Search country or code"
						aria-label="Search countries"
						role="combobox"
						aria-expanded="true"
						aria-controls={listId}
						aria-activedescendant={results[active] ? `${listId}-${results[active].code}` : undefined}
						autoComplete="off"
						value={q}
						onChange={(e) => {
							setQ(e.target.value);
							setActive(0);
						}}
						onKeyDown={onSearchKey}
					/>
					<ul id={listId} role="listbox" aria-label="Countries" className="ss-phone__list" ref={listRef}>
						{results.length === 0 && (
							<li className="ss-phone__none" role="option" aria-disabled="true" aria-selected="false">
								No country found
							</li>
						)}
						{results.map((c, i) => (
							<li
								key={c.code}
								id={`${listId}-${c.code}`}
								data-i={i}
								role="option"
								aria-selected={c.code === country}
								className={`ss-phone__opt${i === active ? " is-active" : ""}${c.code === country ? " is-current" : ""}`}
								onMouseDown={(e) => e.preventDefault()}
								onClick={() => choose(c)}
								onMouseMove={() => i !== active && setActive(i)}
							>
								<img src={flagSrc(c.code)} alt="" width="24" height="18" loading="lazy" className="ss-phone__flag" />
								<span className="ss-phone__name">{c.name}</span>
								<span className="ss-phone__code">+{c.dial}</span>
							</li>
						))}
					</ul>
				</div>
			)}
		</div>
	);
};

export default PhoneInput;
