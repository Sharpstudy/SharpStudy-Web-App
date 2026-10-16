import React from "react";
import Link from "next/link";
import { useRouter } from "next/router";
import { useCurrentUser } from "./UserContext";
import { useDashboardHeader } from "./accountLinks";

const columns = [
	{
		title: "Learn",
		links: [
			{ href: "/courses/", label: "All courses" },
			{ href: "/blog/blogs/", label: "Blog" },
			{ href: "/become-an-instructor/", label: "Become an instructor" },
		],
	},
	{
		title: "Company",
		links: [
			{ href: "/about-us/", label: "About us" },
			{ href: "/contact-us/", label: "Contact" },
			{ href: "/faq/", label: "FAQ" },
		],
	},
	{
		title: "Legal",
		links: [
			{ href: "/terms-conditions/", label: "Terms & conditions" },
			{ href: "/privacy-policy/", label: "Privacy policy" },
		],
	},
];

const Footer = () => {
	const user = useCurrentUser();
	const { pathname } = useRouter();
	// Not rendered at all on student/instructor dashboard pages (public chrome only).
	if (useDashboardHeader(user, pathname)) return null;
	const currentYear = new Date().getFullYear();
	return (
		<footer className="ss-footer">
			<div className="ss-container ss-container--wide">
				<div className="ss-footer__grid">
					<div className="ss-footer__brand">
						<Link href="/">
							<a aria-label="SharpStudy home">
								{/* eslint-disable-next-line @next/next/no-img-element */}
								<img src="/images/sharpstudy.png" alt="SharpStudy" width="170" height="28" />
							</a>
						</Link>
						<p>
							SharpStudy Learning Inc. is a project-based cognitive skills
							development platform that uses advanced pedagogy for practical and
							enhanced learning.
						</p>
						<div className="ss-footer__social">
							<a
								href="https://www.facebook.com/sharpstudyio"
								aria-label="SharpStudy on Facebook"
								target="_blank"
								rel="noopener noreferrer"
							>
								<i className="ri-facebook-fill" aria-hidden="true"></i>
							</a>
							<a
								href="https://www.linkedin.com/company/sharpstudy"
								aria-label="SharpStudy on LinkedIn"
								target="_blank"
								rel="noopener noreferrer"
							>
								<i className="ri-linkedin-fill" aria-hidden="true"></i>
							</a>
						</div>
					</div>

					{columns.map((col) => (
						<nav key={col.title} aria-label={col.title}>
							<h2 className="ss-footer__title">{col.title}</h2>
							<ul>
								{col.links.map((l) => (
									<li key={l.href}>
										<Link href={l.href}>
											<a>{l.label}</a>
										</Link>
									</li>
								))}
							</ul>
						</nav>
					))}

					<div>
						<h2 className="ss-footer__title">Contact</h2>
						<ul className="ss-footer__contact">
							<li>
								<i className="ri-phone-line" aria-hidden="true"></i>
								<a href="tel:16047670944">1-604-767-0944</a>
							</li>
							<li>
								<i className="ri-mail-line" aria-hidden="true"></i>
								<a href="mailto:hello@sharpstudy.io">hello@sharpstudy.io</a>
							</li>
							<li>
								<i className="ri-map-pin-line" aria-hidden="true"></i>
								<span>151 West Hasting St, Vancouver, B.C. V3c 4L8 Canada</span>
							</li>
						</ul>
					</div>
				</div>

				<div className="ss-footer__bottom">
					<p>
						&copy; {currentYear} SharpStudy. Proudly owned by{" "}
						<a href="https://www.hypervers.co/" target="_blank" rel="noopener noreferrer">
							Hypervers Solutions Inc.
						</a>
					</p>
				</div>
			</div>
		</footer>
	);
};

export default Footer;
