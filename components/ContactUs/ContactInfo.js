import React from "react";

// Contact details match the site footer. The previous "+009 3867 321/532"
// numbers were theme placeholders and have been removed (flagged for review).
const items = [
	{
		icon: "ri-phone-line",
		title: "Call us",
		lines: [{ href: "tel:16047670944", label: "1-604-767-0944" }],
	},
	{
		icon: "ri-mail-line",
		title: "Email us",
		lines: [
			{ href: "mailto:hello@sharpstudy.io", label: "hello@sharpstudy.io" },
			{ href: "mailto:mike@evolvelab.co", label: "mike@evolvelab.co" },
		],
	},
	{
		icon: "ri-map-pin-line",
		title: "Visit us",
		lines: [{ label: "151 West Hasting St, Vancouver, B.C. V3C 4L8, Canada" }],
	},
];

const ContactInfo = () => {
	return (
		<ul className="ss-contact-info">
			{items.map((it) => (
				<li key={it.title} className="ss-card">
					<span className="ss-icon-tile" aria-hidden="true">
						<i className={it.icon}></i>
					</span>
					<div>
						<h2>{it.title}</h2>
						{it.lines.map((l) =>
							l.href ? (
								<a key={l.label} href={l.href}>
									{l.label}
								</a>
							) : (
								<p key={l.label}>{l.label}</p>
							)
						)}
					</div>
				</li>
			))}
		</ul>
	);
};

export default ContactInfo;
