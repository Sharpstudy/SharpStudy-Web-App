import React from "react";
import Link from "next/link";
import { useRouter } from "next/router";
import Navbar from "@/components/_App/Navbar";
import Footer from "@/components/_App/Footer";
import { PageHeader } from "@/components/ui";

const sections = {
	learning: {
		title: "My learning",
		tabs: [
			{ href: "/learning/my-courses/", label: "My courses", icon: "ri-book-read-line" },
			{ href: "/learning/wishlist/", label: "Wishlist", icon: "ri-heart-3-line" },
			{ href: "/learning/my-purchase-history/", label: "Purchases", icon: "ri-bank-card-line" },
		],
	},
	account: {
		title: "Account settings",
		description: "Manage your profile details and photo.",
		tabs: [
			{ href: "/profile/basic-information/", label: "Profile", icon: "ri-user-line" },
			{ href: "/profile/photo/", label: "Profile photo", icon: "ri-image-line" },
		],
	},
};

const norm = (p) => p.replace(/\/$/, "");

// Shared chrome for student/account pages: header, section tabs, footer.
const StudentLayout = ({ user, section = "learning", title, description, children }) => {
	const { pathname } = useRouter();
	const cfg = sections[section];
	const greeting =
		section === "learning" && user && user.first_name
			? `Welcome back, ${user.first_name}. Pick up where you left off.`
			: undefined;

	return (
		<>
			<Navbar user={user} />
			<main>
				<PageHeader
					title={title || cfg.title}
					description={description || cfg.description || greeting}
					crumbs={[{ href: "/", label: "Home" }, { label: title || cfg.title }]}
				/>
				<div className="ss-container ss-container--wide ss-student">
					<nav className="ss-tabs" aria-label={cfg.title}>
						{cfg.tabs.map((t) => {
							const active = norm(pathname) === norm(t.href);
							return (
								<Link href={t.href} key={t.href}>
									<a className={active ? "active" : ""} aria-current={active ? "page" : undefined}>
										<i className={t.icon} aria-hidden="true"></i>
										{t.label}
									</a>
								</Link>
							);
						})}
					</nav>
					{children}
				</div>
			</main>
			<Footer />
		</>
	);
};

export default StudentLayout;
