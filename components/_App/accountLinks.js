// Account menu entries shared by the desktop profile menu and the mobile
// drawer. Role checks mirror the original ProfileDropdown exactly.
export const accountLinks = (role) => {
	const links = [];
	if (role === "instructor") {
		links.push(
			{ href: "/instructor/courses/", label: "My Courses", icon: "ri-book-2-line" },
			{ href: "/instructor/course/create/", label: "Create New Course", icon: "ri-add-box-line" }
		);
	}
	if (role === "admin") {
		links.push({ href: "/admin/", label: "Admin Dashboard", icon: "ri-dashboard-line" });
	}
	links.push(
		{ href: "/learning/my-courses/", label: "My Learning", icon: "ri-book-read-line" },
		{ href: "/learning/my-purchase-history/", label: "My Purchases", icon: "ri-bank-card-line" },
		{ href: "/learning/wishlist/", label: "Wishlist", icon: "ri-heart-3-line" },
		{ href: "/profile/basic-information/", label: "Account Settings", icon: "ri-user-settings-line" }
	);
	return links;
};

export const primaryNav = [
	{ href: "/", label: "Home", exact: true },
	{ href: "/courses/", label: "Courses" },
	{ href: "/blog/blogs/", label: "Blog" },
	{ href: "/about-us/", label: "About" },
	{ href: "/contact-us/", label: "Contact" },
];
