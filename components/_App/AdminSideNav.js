import React, { useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/router";

const items = [
	{ href: "/admin/", match: "/admin", exact: true, label: "Dashboard", icon: "ri-dashboard-line" },
	{ href: "/admin/courses/", match: "/admin/courses", label: "Courses", icon: "ri-book-2-line" },
	{ href: "/admin/instructor/", match: "/admin/instructor", label: "Instructors", icon: "ri-slideshow-2-line" },
	{ href: "/admin/students/", match: "/admin/students", label: "Students", icon: "ri-group-line" },
	{ href: "/admin/partners/", match: "/admin/partners", label: "Partners", icon: "ri-hand-heart-line" },
	{ href: "/admin/testimonials/", match: "/admin/testimonials", label: "Testimonials", icon: "ri-chat-quote-line" },
	{ href: "/admin/categories/", match: "/admin/categories", label: "Categories", icon: "ri-folder-2-line" },
	{ href: "/admin/coupons/", match: "/admin/coupons", label: "Coupons", icon: "ri-coupon-3-line" },
	{ href: "/admin/meetings/", match: "/admin/meetings", label: "Meeting requests", icon: "ri-calendar-check-line" },
	{ href: "/admin/mastery/", match: "/admin/mastery", label: "Mastery Ladder", icon: "ri-stairs-line" },
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
					const active = it.exact
						? currentRoute === it.match
						: currentRoute === it.match || currentRoute.startsWith(it.match + "/");
					return (
						<Link href={it.href} key={it.href}>
							<a className={active ? "active" : ""} aria-current={active ? "page" : undefined}>
								<i className={it.icon} aria-hidden="true"></i>
								{it.label}
							</a>
						</Link>
					);
				})}
			</nav>
		</>
	);
};

export default AdminSideNav;
