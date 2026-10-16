import React from "react";
import Link from "next/link";
import { useRouter } from "next/router";
import Navbar from "@/components/_App/Navbar";
import Footer from "@/components/_App/Footer";

const nav = [
	{ href: "/instructor/dashboard/", label: "Dashboard", icon: "ri-dashboard-3-line" },
	{ href: "/instructor/courses/", label: "My courses", icon: "ri-book-2-line" },
	{ href: "/instructor/course/create/", label: "Create course", icon: "ri-add-box-line" },
	{ href: "/instructor/course/create-quiz/", label: "Create quiz", icon: "ri-questionnaire-line" },
	{ href: "/instructor/live/", label: "Live sessions", icon: "ri-calendar-event-line" },
	{ href: "/instructor/course/create-class/", label: "Create class room", icon: "ri-live-line" },
	{ href: "/instructor/students/", label: "Students", icon: "ri-group-line" },
	{ href: "/instructor/profile/", label: "Teaching profile", icon: "ri-profile-line" },
];

const norm = (p) => p.replace(/\/$/, "");

// Shared shell for instructor tools: sidebar (desktop) / scrollable tabs
// (mobile), page title row and content area.
const InstructorLayout = ({ user, title, description, actions, children }) => {
	const { pathname } = useRouter();
	return (
		<>
			<Navbar user={user} />
			<div className="ss-dash">
				<div className="ss-container ss-container--wide ss-dash__grid">
					<aside className="ss-dash__side" aria-label="Instructor">
						<p className="ss-dash__label">Instructor</p>
						<nav className="ss-dash__nav">
							{nav.map((item) => {
								const active = norm(pathname) === norm(item.href);
								return (
									<Link href={item.href} key={item.href}>
										<a className={active ? "active" : ""} aria-current={active ? "page" : undefined}>
											<i className={item.icon} aria-hidden="true"></i>
											{item.label}
										</a>
									</Link>
								);
							})}
						</nav>
					</aside>
					<main className="ss-dash__main">
						{(title || actions) && (
							<div className="ss-dash__head">
								<div style={{ minWidth: 0 }}>
									{title && <h1>{title}</h1>}
									{description && <p>{description}</p>}
								</div>
								{actions && <div className="ss-dash__actions">{actions}</div>}
							</div>
						)}
						{children}
					</main>
				</div>
			</div>
			<Footer />
		</>
	);
};

export default InstructorLayout;
