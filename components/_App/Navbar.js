import React, { useEffect, useState } from "react";
import Router, { useRouter } from "next/router";
import Link from "next/link";
import NProgress from "nprogress";
import { useSelector } from "react-redux";
import ProfileDropdown from "./ProfileDropdown";
import SearchForm from "./SearchForm";
import { accountLinks, primaryNav } from "./accountLinks";
import { handleLogout } from "@/utils/auth";

Router.onRouteChangeStart = () => NProgress.start();
Router.onRouteChangeComplete = () => NProgress.done();
Router.onRouteChangeError = () => NProgress.done();

const isActive = (pathname, item) => {
	const target = item.href.replace(/\/$/, "") || "/";
	const current = pathname.replace(/\/$/, "") || "/";
	return item.exact ? current === target : current === target || current.startsWith(target + "/");
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

	return (
		<>
			<a href="#main" className="ss-skip-link">
				Skip to content
			</a>
			<header id="navbar" className={`ss-header${scrolled ? " is-scrolled" : ""}`}>
				<div className="ss-container ss-container--wide ss-header__inner">
					<Link href="/">
						<a className="ss-header__brand" aria-label="SharpStudy home">
							{/* eslint-disable-next-line @next/next/no-img-element */}
							<img src="/images/sharpstudy.png" alt="SharpStudy" width="170" height="28" />
						</a>
					</Link>

					<nav className="ss-header__nav" aria-label="Main">
						<ul>
							{primaryNav.map((item) => (
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
							))}
						</ul>
					</nav>

					<div className="ss-header__search">
						<SearchForm formClass="ss-search" btnClass="ss-search__btn" />
					</div>

					<div className="ss-header__actions">
						<CartLink />
						{user ? (
							<ProfileDropdown {...user} />
						) : (
							<>
								<Link href="/auth">
									<a className="ss-btn ss-btn--ghost ss-btn--sm d-none d-sm-inline-flex">Log in</a>
								</Link>
								<Link href="/auth">
									<a className="ss-btn ss-btn--sm d-none d-sm-inline-flex">Get started</a>
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
					<SearchForm formClass="ss-search" btnClass="ss-search__btn" />

					<nav aria-label="Mobile">
						<ul className="ss-drawer__list">
							{primaryNav.map((item) => (
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
							))}
						</ul>
					</nav>

					{user ? (
						<>
							<p className="ss-drawer__label">Account</p>
							<ul className="ss-drawer__list ss-drawer__list--icons">
								{accountLinks(user.role).map((l) => (
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
								<a className="ss-btn ss-btn--block">Get started</a>
							</Link>
							<Link href="/auth">
								<a className="ss-btn ss-btn--secondary ss-btn--block">Log in</a>
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
