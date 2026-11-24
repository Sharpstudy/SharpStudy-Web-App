import React, { useEffect, useState } from "react";
import Router, { useRouter } from "next/router";
import Link from "next/link";
import NProgress from "nprogress";
import { useSelector } from "react-redux";
import ProfileDropdown from "./ProfileDropdown";
import SearchForm from "./SearchForm";
import { navModel, dashboardHome, isShoppingArea, isTelecallerOnly } from "./accountLinks";
import { handleLogout } from "@/utils/auth";
import { TELECALLER_HOME } from "@/lib/auth/telecallerNav";
import { APPLICATION_PAGE, isTelecallerRestricted } from "@/lib/auth/telecallerState";
import { BookFreeDemoButton } from "@/components/FreeDemo/FreeDemoProvider";
import { headerSource, showHeaderDemo } from "@/lib/freeDemo/config";

Router.onRouteChangeStart = () => NProgress.start();
Router.onRouteChangeComplete = () => NProgress.done();
Router.onRouteChangeError = () => NProgress.done();

const isActive = (pathname, item) => {
	const target = item.href.replace(/\/$/, "") || "/";
	const current = pathname.replace(/\/$/, "") || "/";
	return item.exact ? current === target : current === target || current.startsWith(target + "/");
};

// "Programs" dropdown. A real button (aria-expanded) that opens on click or keyboard and also on hover/focus-within via CSS; Escape or a
// click elsewhere closes it. The parent entry itself is a link to the programs overview.
const NavDropdown = ({ item, pathname }) => {
	const [open, setOpen] = useState(false);
	const ref = React.useRef(null);
	const active = isActive(pathname, item);
	useEffect(() => {
		if (!open) return;
		const onDoc = (e) => ref.current && !ref.current.contains(e.target) && setOpen(false);
		const onKey = (e) => e.key === "Escape" && setOpen(false);
		document.addEventListener("mousedown", onDoc);
		document.addEventListener("keydown", onKey);
		return () => {
			document.removeEventListener("mousedown", onDoc);
			document.removeEventListener("keydown", onKey);
		};
	}, [open]);
	useEffect(() => setOpen(false), [pathname]);
	return (
		<li className={`ss-header__dropdown${open ? " is-open" : ""}`} ref={ref}>
			<button
				type="button"
				className={`ss-header__dropbtn${active ? " active" : ""}`}
				aria-expanded={open}
				aria-haspopup="true"
				aria-controls="ss-programs-menu"
				onClick={() => setOpen((o) => !o)}
			>
				{item.label}
				<i className="ri-arrow-down-s-line" aria-hidden="true"></i>
			</button>
			<ul id="ss-programs-menu" className="ss-header__menu" aria-label={item.label}>
				{item.children.map((c) => (
					<li key={c.href}>
						<Link href={c.href}>
							<a className={isActive(pathname, c) ? "active" : ""} onClick={() => setOpen(false)}>
								{c.label}
							</a>
						</Link>
					</li>
				))}
			</ul>
		</li>
	);
};

const CartLink = () => {
	const count = useSelector((state) => state.cart.cartItems.length);
	return (
		<Link href="/checkout">
			<a className="ss-header__icon" aria-label={`Cart, ${count} item${count === 1 ? "" : "s"}`}>
				<i className="ri-shopping-cart-2-line" aria-hidden="true"></i>
				{count > 0 && <span className="ss-header__count">{count}</span>}
			</a>
		</Link>
	);
};

const Navbar = ({ user }) => {
	const router = useRouter();
	const [drawer, setDrawer] = useState(false);
	const [scrolled, setScrolled] = useState(false);
	// `user` is verified server-side in _app (token -> database), so this is
	// correct on first render, on refresh and on direct navigation.
	const { dash, primary: nav, account } = navModel(user, router.pathname);
	// Course search and the cart belong to the shopping areas only (catalogue, course details, categories, checkout).
	// (A visitor who is not signed in is redirected away from the shopping areas before they render; the checks below are a second guard.)
	const shopping = !!user && isShoppingArea(router.pathname);
	// "Book Free Demo": only for visitors on public marketing pages (never login, checkout, careers or any dashboard; see lib/freeDemo/config.js).
	const demo = showHeaderDemo(router.pathname, user);

	useEffect(() => {
		const onScroll = () => setScrolled(window.scrollY > 8);
		onScroll();
		window.addEventListener("scroll", onScroll, { passive: true });
		return () => window.removeEventListener("scroll", onScroll);
	}, []);

	useEffect(() => {
		const close = () => setDrawer(false);
		router.events.on("routeChangeStart", close);
		return () => router.events.off("routeChangeStart", close);
	}, [router.events]);

	useEffect(() => {
		if (!drawer) return;
		const onKey = (e) => e.key === "Escape" && setDrawer(false);
		document.addEventListener("keydown", onKey);
		const prev = document.body.style.overflow;
		document.body.style.overflow = "hidden";
		return () => {
			document.removeEventListener("keydown", onKey);
			document.body.style.overflow = prev;
		};
	}, [drawer]);

	// An approved, ACTIVE telecaller gets a minimal header: the logo and the account menu (Telecaller Dashboard, Account Settings, Log out).
	// No public links, search, cart, menu button or drawer. The flag is the server-computed `telecaller_access` (never e-mail or role);
	// this is display only, and the telecaller page and APIs re-check access from the database.
	// A pending / more-information applicant or a deactivated telecaller gets the same minimal header (their menu is only the application
	// status and Account Settings, see navModel): no search, cart, public links or drawer, so no student shortcut is left on desktop or mobile.
	if (isTelecallerOnly(user) || isTelecallerRestricted(user)) {
		const home = isTelecallerOnly(user) ? TELECALLER_HOME : APPLICATION_PAGE;
		return (
			<>
				<a href="#main" className="ss-skip-link">
					Skip to content
				</a>
				<header id="navbar" className={`ss-header ss-header--minimal${scrolled ? " is-scrolled" : ""}`}>
					<div className="ss-container ss-container--wide ss-header__inner">
						<Link href={home}>
							<a className="ss-header__brand" aria-label={isTelecallerOnly(user) ? "SharpStudy telecaller dashboard" : "SharpStudy telecaller application"}>
								{/* eslint-disable-next-line @next/next/no-img-element */}
								<img src="/images/sharpstudy.png" alt="SharpStudy" width="170" height="28" />
							</a>
						</Link>
						<div className="ss-header__actions">
							<ProfileDropdown {...user} links={account} />
						</div>
					</div>
				</header>
				<span id="main" tabIndex={-1} />
			</>
		);
	}

	return (
		<>
			<a href="#main" className="ss-skip-link">
				Skip to content
			</a>
			<header id="navbar" className={`ss-header${scrolled ? " is-scrolled" : ""}`}>
				<div className="ss-container ss-container--wide ss-header__inner">
					<Link href={dash ? dashboardHome(user.role) : "/"}>
						<a className="ss-header__brand" aria-label="SharpStudy home">
							{/* eslint-disable-next-line @next/next/no-img-element */}
							<img src="/images/sharpstudy.png" alt="SharpStudy" width="170" height="28" />
						</a>
					</Link>

					<nav className="ss-header__nav" aria-label="Main">
						<ul>
							{nav.map((item) =>
								item.children ? (
									<NavDropdown key={item.href} item={item} pathname={router.pathname} />
								) : (
									<li key={item.href}>
										<Link href={item.href}>
											<a
												className={isActive(router.pathname, item) ? "active" : ""}
												aria-current={isActive(router.pathname, item) ? "page" : undefined}
											>
												{item.label}
											</a>
										</Link>
									</li>
								)
							)}
						</ul>
					</nav>

					{!dash && shopping && (
						<div className="ss-header__search">
							<SearchForm formClass="ss-search" btnClass="ss-search__btn" />
						</div>
					)}

					<div className="ss-header__actions">
						{demo && (
							<BookFreeDemoButton source={headerSource(router.pathname)} size="sm" className="ss-header__demo">
								<span className="d-none d-md-inline">Book Free Demo</span>
								<span className="d-md-none">Free Demo</span>
							</BookFreeDemoButton>
						)}
						{shopping && !isTelecallerOnly(user) && <CartLink />}
						{user ? (
							<ProfileDropdown {...user} links={account} />
						) : (
							<>
								<Link href="/auth">
									<a className="ss-btn ss-btn--sm d-none d-sm-inline-flex">Login</a>
								</Link>
							</>
						)}
						<button
							type="button"
							className="ss-header__icon ss-header__toggle"
							aria-label="Open menu"
							aria-expanded={drawer}
							aria-controls="ss-drawer"
							onClick={() => setDrawer(true)}
						>
							<i className="ri-menu-line" aria-hidden="true"></i>
						</button>
					</div>
				</div>
			</header>

			{/* Mobile / tablet drawer */}
			<div
				className={`ss-drawer-backdrop${drawer ? " is-open" : ""}`}
				onClick={() => setDrawer(false)}
				aria-hidden="true"
			/>
			<aside
				id="ss-drawer"
				className={`ss-drawer${drawer ? " is-open" : ""}`}
				aria-label="Menu"
				aria-hidden={!drawer}
				{...(!drawer && { inert: "" })}
			>
				<div className="ss-drawer__head">
					{/* eslint-disable-next-line @next/next/no-img-element */}
					<img src="/images/sharpstudy.png" alt="SharpStudy" height="24" />
					<button
						type="button"
						className="ss-header__icon"
						aria-label="Close menu"
						onClick={() => setDrawer(false)}
					>
						<i className="ri-close-line" aria-hidden="true"></i>
					</button>
				</div>

				<div className="ss-drawer__body">
					{demo && (
						<div className="ss-drawer__demo">
							<BookFreeDemoButton source={headerSource(router.pathname)} size="lg" className="ss-btn--block">
								Book Free Demo
							</BookFreeDemoButton>
						</div>
					)}
					{!dash && shopping && <SearchForm formClass="ss-search" btnClass="ss-search__btn" />}

					<nav aria-label="Mobile">
						<ul className="ss-drawer__list">
							{nav.map((item) =>
								item.children ? (
									<li key={item.href} className="ss-drawer__group">
										<span className="ss-drawer__grouplabel">{item.label}</span>
										<ul>
											{item.children.map((c) => (
												<li key={c.href}>
													<Link href={c.href}>
														<a className={isActive(router.pathname, c) ? "active" : ""}>{c.label}</a>
													</Link>
												</li>
											))}
										</ul>
									</li>
								) : (
									<li key={item.href}>
										<Link href={item.href}>
											<a
												className={isActive(router.pathname, item) ? "active" : ""}
												aria-current={isActive(router.pathname, item) ? "page" : undefined}
											>
												{item.label}
											</a>
										</Link>
									</li>
								)
							)}
						</ul>
					</nav>

					{user ? (
						<>
							<p className="ss-drawer__label">Account</p>
							<ul className="ss-drawer__list ss-drawer__list--icons">
								{account.map((l) => (
									<li key={l.href}>
										<Link href={l.href}>
											<a>
												<i className={l.icon} aria-hidden="true"></i>
												{l.label}
											</a>
										</Link>
									</li>
								))}
								<li>
									<button type="button" onClick={handleLogout}>
										<i className="ri-logout-box-r-line" aria-hidden="true"></i>
										Log out
									</button>
								</li>
							</ul>
						</>
					) : (
						<div className="d-grid gap-2 mt-4">
							<Link href="/auth">
								<a className="ss-btn ss-btn--block">Login</a>
							</Link>
						</div>
					)}
				</div>
			</aside>
			<span id="main" tabIndex={-1} />
		</>
	);
};

export default Navbar;
