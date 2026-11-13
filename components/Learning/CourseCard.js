import React from "react";
import Link from "next/link";

// Enrolled-course card. Live-class courses open the class room, others the player.
const CourseCard = ({ course: { user, image, title, slug, is_class } }) => {
	const href = is_class ? `/learning/course/class/${slug}` : `/learning/course/${slug}`;
	return (
		<article className="ss-course-card">
			<Link href={href}>
				<a className="ss-course-card__media" tabIndex={-1} aria-hidden="true">
					{/* eslint-disable-next-line @next/next/no-img-element */}
					<img src={image} alt="" loading="lazy" />
				</a>
			</Link>
			<span className={`ss-badge ss-course-card__flag ${is_class ? "ss-badge--accent" : "ss-badge--primary"}`}>
				<i className={is_class ? "ri-live-line" : "ri-play-circle-line"} aria-hidden="true"></i>
				{is_class ? "Live class" : "Self-paced"}
			</span>
			<div className="ss-course-card__body">
				<h3 className="ss-course-card__title">
					<Link href={href}>
						<a>{title}</a>
					</Link>
				</h3>
				{user && (
					<div className="ss-course-card__meta">
						<span className="ss-course-card__author">
							{/* eslint-disable-next-line @next/next/no-img-element */}
							<img
								className="ss-avatar ss-avatar--sm"
								src={user.profile_photo || "/images/admin/admin-9.jpg"}
								alt=""
							/>
							<span className="ss-truncate">{`${user.first_name} ${user.last_name}`}</span>
						</span>
					</div>
				)}
				<div className="ss-course-card__foot">
					<span className="ss-muted" style={{ fontSize: "var(--ss-fs-sm)" }}>
						{is_class ? "Join your class" : "Continue learning"}
					</span>
					<span className="ss-btn ss-btn--soft ss-btn--sm" aria-hidden="true">
						{is_class ? "Join" : "Open"}
						<i className="ri-arrow-right-line"></i>
					</span>
				</div>
			</div>
		</article>
	);
};

export default CourseCard;
