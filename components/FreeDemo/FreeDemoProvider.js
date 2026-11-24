import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/router";
import { useCurrentUser } from "@/components/_App/UserContext";
import { Button } from "@/components/ui";
import { AUTO_POPUP, autoPlan, autoPopupEligible, markSubmitted, postponeNext, recordClosed, recordShown, sourceId, validProgram } from "@/lib/freeDemo/config";

// The booking dialog is loaded only when it is first opened (it pulls in the form and axios).
const FreeDemoModal = dynamic(() => import("./FreeDemoModal"), { ssr: false });

const FreeDemoContext = createContext({ openDemo: () => {} });
export const useFreeDemo = () => useContext(FreeDemoContext);

const stores = () => {
	const get = (name) => {
		try {
			return window[name];
		} catch (e) {
			return undefined;
		}
	};
	return { session: get("sessionStorage"), local: get("localStorage") };
};

// ONE provider for the whole site (mounted in Layout). It owns the single dialog instance and the automatic popup, so every button and the
// timer open exactly the same dialog and can never open two.
//
// Automatic popup (rules and storage in lib/freeDemo/config.js): 5 s after an eligible page opens, then 10 s after each close without a request,
// at most 3 per visit, never again once a request was sent. The schedule is kept in sessionStorage ("next one at ...", "n shown"); the single
// timer below is only a wake-up call derived from it, re-derived (never restarted from scratch) on every page change, so navigating cannot
// reset the 5 s start or the count. A "Book Free Demo" button always opens the dialog at once and never touches the schedule or the count.
export const FreeDemoProvider = ({ children }) => {
	const { pathname } = useRouter();
	const user = useCurrentUser();
	const [session, setSession] = useState(null); // { program, source, page } while the dialog is open
	const sessionRef = useRef(null);
	const openRef = useRef(false);
	const openerRef = useRef(null);
	const timerRef = useRef(null); // the ONE pending wake-up (never more than one)
	const prevPathRef = useRef(pathname);
	const routeStartRef = useRef(0); // performance.now() when the current route opened (0 = navigation start)
	const eligibleRef = useRef(false);
	eligibleRef.current = autoPopupEligible(pathname, user);

	const clearTimer = useCallback(() => {
		if (timerRef.current) {
			clearTimeout(timerRef.current);
			timerRef.current = null;
		}
	}, []);

	const openDemo = useCallback((opts = {}) => {
		if (openRef.current) {
			const el = document.getElementById("free-demo-dialog");
			if (el) {
				const f = el.querySelector("input, button");
				if (f) f.focus();
			}
			return; // already open: never a second instance
		}
		openRef.current = true;
		openerRef.current = typeof document !== "undefined" ? document.activeElement : null;
		const next = { program: validProgram(opts.program), source: sourceId(opts.source), page: typeof window !== "undefined" ? window.location.pathname : "/" };
		sessionRef.current = next;
		setSession(next);
	}, []);

	const fireRef = useRef(() => {});
	// (Re)derive the single wake-up from the stored schedule. Clears any earlier one first, so timers can never pile up.
	const arm = useCallback(() => {
		clearTimer();
		if (typeof window === "undefined" || !eligibleRef.current) return; // excluded page or signed-in account: nothing scheduled (the schedule is kept)
		const plan = autoPlan(stores(), Date.now(), typeof performance !== "undefined" ? performance.now() - routeStartRef.current : 0);
		if (plan.stop) return;
		timerRef.current = setTimeout(() => {
			timerRef.current = null;
			fireRef.current();
		}, plan.delay);
	}, [clearTimer]);

	fireRef.current = () => {
		if (!eligibleRef.current) return; // left for an excluded page meanwhile; re-armed when they come back
		if (document.hidden) return; // background tab: re-armed when the tab is visible again
		const st = stores();
		if (autoPlan(st).stop) return;
		if (openRef.current) {
			// a dialog (for example one a button opened) is already open: no second one, no count; try again 10 s later
			postponeNext(st.session, AUTO_POPUP.repeatDelayMs);
			arm();
			return;
		}
		if (document.body.style.overflow === "hidden") {
			// the menu drawer or a lightbox is open: do not stack on top of it, and do not count it
			postponeNext(st.session, 3000);
			arm();
			return;
		}
		recordShown(st.session);
		openDemo({ source: "automatic_popup" });
	};

	const closeDemo = useCallback(
		(how) => {
			const wasAutomatic = !!sessionRef.current && sessionRef.current.source === "automatic_popup";
			openRef.current = false;
			sessionRef.current = null;
			setSession(null);
			// Closing an AUTOMATIC popup without a request being sent: the next one is 10 s from now (if the visit's limit allows it).
			// Closing one a button opened leaves the schedule alone.
			if (wasAutomatic) recordClosed(stores().session);
			arm();
			const el = openerRef.current;
			if (how !== "navigate" && el && typeof el.focus === "function" && document.contains(el)) el.focus();
		},
		[arm]
	);
	// A request was sent: stop every further automatic popup now (and for a week on this browser).
	const onSubmitted = useCallback(() => {
		markSubmitted(stores());
		clearTimer();
	}, [clearTimer]);

	// Fetch the dialog's code while the page is idle, so the popup is ready the moment its timer fires.
	useEffect(() => {
		if (!eligibleRef.current) return undefined;
		const load = () => import("./FreeDemoModal").catch(() => {});
		if (typeof window.requestIdleCallback === "function") {
			const h = window.requestIdleCallback(load, { timeout: 2500 });
			return () => window.cancelIdleCallback && window.cancelIdleCallback(h);
		}
		load(); // no idle callback (older Safari): just fetch it now
		return undefined;
	}, [pathname, user]);

	// A dialog never survives a page change (its recorded page would be wrong).
	useEffect(() => {
		if (openRef.current) closeDemo("navigate");
		// The page "opened" at navigation start for the first route, and at the route change for every later one (declared before the arm effect below).
		if (prevPathRef.current !== pathname) {
			prevPathRef.current = pathname;
			routeStartRef.current = typeof performance !== "undefined" ? performance.now() : 0;
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [pathname]);

	// New page or account: re-derive the wake-up from the stored schedule (does not restart it). Cleared on unmount.
	useEffect(() => {
		arm();
		return clearTimer;
	}, [pathname, user, arm, clearTimer]);

	// Back from a background tab: the wake-up may have been skipped while hidden.
	useEffect(() => {
		const onVisible = () => {
			if (!document.hidden) arm();
		};
		document.addEventListener("visibilitychange", onVisible);
		return () => document.removeEventListener("visibilitychange", onVisible);
	}, [arm]);

	const value = useMemo(() => ({ openDemo }), [openDemo]);
	return (
		<FreeDemoContext.Provider value={value}>
			{children}
			{session && <FreeDemoModal initial={session} onClose={() => closeDemo("dismiss")} onSubmitted={onSubmitted} />}
		</FreeDemoContext.Provider>
	);
};

// The shared "Book Free Demo" button. Opens the dialog on the current page (no navigation). `program` preselects a program.
export const BookFreeDemoButton = ({ source, program, variant = "primary", size, className = "", children = "Book Free Demo", icon, iconRight }) => {
	const { openDemo } = useFreeDemo();
	return (
		<Button
			variant={variant}
			size={size}
			icon={icon}
			iconRight={iconRight}
			className={`ss-demo-btn ${className}`.trim()}
			data-demo-source={source}
			aria-haspopup="dialog"
			onClick={() => openDemo({ source, program })}
		>
			{children}
		</Button>
	);
};

export { AUTO_POPUP };
