import React, { useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/router";

const items = [
	{ href: "/admin/", match: "/admin", exact: true, label: "Dashboard", icon: "ri-dashboard-line" },
	{ href: "/admin/courses/", match: "/admin/courses", label: "Courses", icon: "ri-book-2-line" },
	{ href: "/admin/books/", match: "/admin/books", label: "Books", icon: "ri-book-open-line" },
	{ href: "/admin/instructor/", match: "/admin/instructor", label: "Instructors", icon: "ri-slideshow-2-line" },
	// An expandable group: the sub-links show while the admin is anywhere inside /admin/telecallers.
	{
		href: "/admin/telecallers/",
		match: "/admin/telecallers",
		label: "Telecallers",
		icon: "ri-customer-service-2-line",
		children: [
			{ href: "/admin/telecallers/applications/", label: "Applications", icon: "ri-file-list-3-line" },
			{ href: "/admin/telecallers/approved/", label: "Approved Telecallers", icon: "ri-user-follow-line" },
			{ href: "/admin/telecallers/rejected/", label: "Rejected Applications", icon: "ri-user-unfollow-line" },
			{ href: "/admin/telecallers/activity/", label: "Activity & Call History", icon: "ri-history-line" },
		],
	},
	{ href: "/admin/students/", match: "/admin/students", label: "Students", icon: "ri-group-line" },
	{ href: "/admin/partners/", match: "/admin/partners", label: "Partners", icon: "ri-hand-heart-line" },
	{ href: "/admin/testimonials/", match: "/admin/testimonials", label: "Testimonials", icon: "ri-chat-quote-line" },
	{ href: "/admin/categories/", match: "/admin/categories", label: "Categories", icon: "ri-folder-2-line" },
	{ href: "/admin/coupons/", match: "/admin/coupons", label: "Coupons", icon: "ri-coupon-3-line" },
	{ href: "/admin/meetings/", match: "/admin/meetings", label: "Meeting requests", icon: "ri-calendar-check-line" },
	{ href: "/admin/mastery/", match: "/admin/mastery", label: "Mastery Ladder", icon: "ri-bar-chart-line" },
];

const AdminSideNav = ({ user }) => {
	const isAdmin = user.role === "admin";
	const router = useRouter();
	const currentRoute = router.pathname;

	// Unchanged access guard: non-admins are sent home.
	useEffect(() => {
		if (!isAdmin) {
			router.replace("/");
		}
	}, [user]);

	return (
		<>
			<p className="ss-dash__label">Admin</p>
			<nav className="ss-dash__nav" aria-label="Admin">
				{items.map((it) => {
					const inside = it.exact
						? currentRoute === it.match
						: currentRoute === it.match || currentRoute.startsWith(it.match + "/");
					if (!it.children) {
						return (
							<Link href={it.href} key={it.href}>
								<a className={inside ? "active" : ""} aria-current={inside ? "page" : undefined}>
									<i className={it.icon} aria-hidden="true"></i>
									{it.label}
								</a>
							</Link>
						);
					}
					// Expandable group: the group link is highlighted only on the section root; a child is highlighted on its own page.
					const childActive = (c) => currentRoute === c.href.replace(/\/$/, "") || currentRoute.startsWith(c.href.replace(/\/$/, "") + "/");
					const onChild = it.children.some(childActive);
					return (
						<React.Fragment key={it.href}>
							<Link href={it.href}>
								<a className={inside && !onChild ? "active" : ""} aria-expanded={inside} aria-current={inside && !onChild ? "page" : undefined}>
									<i className={it.icon} aria-hidden="true"></i>
									{it.label}
									<i className={inside ? "ri-arrow-up-s-line" : "ri-arrow-down-s-line"} aria-hidden="true" style={{ marginLeft: "auto" }}></i>
								</a>
							</Link>
							{inside &&
								it.children.map((c) => (
									<Link href={c.href} key={c.href}>
										<a className={`ss-dash__sub ${childActive(c) ? "active" : ""}`} aria-current={childActive(c) ? "page" : undefined}>
											<i className={c.icon} aria-hidden="true"></i>
											{c.label}
										</a>
									</Link>
								))}
						</React.Fragment>
					);
				})}
			</nav>
		</>
	);
};

export default AdminSideNav;
