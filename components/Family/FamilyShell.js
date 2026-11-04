// Parent-side chrome for the family screens: a sidebar on large screens, a tab bar on phones.
// Home / Explore / Progress / Family, as in the reference. Progress is the existing Mastery family dashboard.
import React from "react";
import Head from "next/head";
import Link from "next/link";
import { useRouter } from "next/router";
import { AppMark, Icon } from "./art";
import { useCurrentUser } from "@/components/_App/UserContext";
import { handleParentLogout } from "@/utils/auth";
import { PARENT_HOME } from "@/lib/family/parentMode";

const NAV = [
	{ href: "/", label: "Home", icon: "home", match: (p) => p === "/" },
	{ href: "/books/", label: "Explore", icon: "search", match: (p) => p.startsWith("/books") || p.startsWith("/courses") },
	{ href: "/family/", label: "Progress", icon: "chart", match: (p) => p === "/family" || p === "/family/" },
	{ href: "/family/manage/", label: "Family", icon: "users", match: (p) => p.startsWith("/family/manage") || p.startsWith("/family/setup") },
];

// A parent-only account (lib/family/parentMode.js) gets just Progress and Family, a Logout button, and a logo that stays
// inside the family area. Everyone else who opens a family screen keeps the four-item navigation.
const PARENT_NAV = NAV.filter((n) => n.label === "Progress" || n.label === "Family");

const FamilyShell = ({ title, children, bare = false }) => {
	const { pathname } = useRouter();
	const user = useCurrentUser();
	const parentMode = !!(user && user.is_parent);
	const items = parentMode ? PARENT_NAV : NAV;
	const path = pathname.replace(/\/$/, "") || "/";
	return (
		<div className="fm-root">
			<Head>
				<title>{title ? `${title} · Sharp Study` : "Sharp Study"}</title>
				<meta name="robots" content="noindex" />
			</Head>
			{!bare && (
				<>
					<nav className="fm-nav" aria-label="Family navigation">
						<Link href={parentMode ? PARENT_HOME : "/"}>
							<a className="fm-nav__brand" aria-label={parentMode ? "Sharp Study progress" : "Sharp Study home"}>
								<AppMark size={40} />
								<span className="fm-nav__brandname">Sharp Study</span>
							</a>
						</Link>
						<ul className={`fm-nav__list ${parentMode ? "fm-nav__list--parent" : ""}`}>
							{items.map((n) => {
								const on = n.match(path);
								return (
									<li key={n.label}>
										<Link href={n.href}>
											<a className={`fm-nav__link ${on ? "is-on" : ""}`} aria-current={on ? "page" : undefined}>
												<Icon name={n.icon} size={24} />
												<span>{n.label}</span>
											</a>
										</Link>
									</li>
								);
							})}
							{parentMode && (
								<li>
									<button type="button" className="fm-nav__link fm-nav__logout" onClick={handleParentLogout}>
										<Icon name="back" size={24} />
										<span>Logout</span>
									</button>
								</li>
							)}
						</ul>
					</nav>
				</>
			)}
			<main className={`fm-main ${bare ? "fm-main--bare" : ""}`} id="main">
				{children}
			</main>
		</div>
	);
};

export default FamilyShell;
