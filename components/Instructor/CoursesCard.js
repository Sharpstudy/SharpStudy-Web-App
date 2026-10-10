import React from "react";
import Link from "next/link";
import ActionMenu from "@/components/ui/ActionMenu";
import { plural } from "@/utils/helper";

const CoursesCard = ({
	id,
	title,
	slug,
	short_desc,
	image,
	latest_price,
	before_price,
	lessons,
	is_class,
	enrolments = [],
	onDelete,
}) => {
	const viewHref = is_class ? `/learning/course/class/${slug}` : `/course/${slug}`;
	return (
		<article className="ss-course-card">
			<Link href={viewHref}>
				<a className="ss-course-card__media" tabIndex={-1} aria-hidden="true">
					{/* eslint-disable-next-line @next/next/no-img-element */}
					<img src={image ? image : "/images/courses/courses1.jpg"} alt="" loading="lazy" />
				</a>
			</Link>
			<span className={`ss-badge ss-course-card__flag ${is_class ? "ss-badge--accent" : "ss-badge--primary"}`}>
				{is_class ? "Live class" : "Self-paced"}
			</span>
			<div className="ss-course-card__body">
				<h3 className="ss-course-card__title ss-clamp-2">
					<Link href={viewHref}>
						<a>{title}</a>
					</Link>
				</h3>
				{short_desc && <p className="ss-course-card__desc ss-clamp-2">{short_desc}</p>}
				<div className="ss-course-card__meta">
					<span className="ss-course-card__lessons">
						<i className="ri-play-list-2-line" aria-hidden="true"></i> {plural(lessons || 0, "lesson")}
					</span>
					<span className="ss-course-card__lessons">
						<i className="ri-group-line" aria-hidden="true"></i> {plural(enrolments.length, "student")}
					</span>
				</div>
				<div className="ss-course-card__foot">
					<div className="ss-course-card__price">
						{latest_price > 0 ? `$${latest_price}` : "Free"}
						{before_price > 0 && <del>${before_price}</del>}
					</div>
					<div className="ss-course-card__actions">
						<Link href={`/instructor/course/edit/${id}`}>
							<a className="ss-btn ss-btn--soft ss-btn--sm">
								<i className="ri-edit-line" aria-hidden="true"></i> Edit
							</a>
						</Link>
						<ActionMenu
							label={`More actions for ${title}`}
							items={[
								{ href: `/instructor/course/upload/${id}`, label: "Upload video", icon: "ri-upload-cloud-2-line" },
								{ href: `/instructor/course/uploads/${id}`, label: "Manage videos", icon: "ri-video-line" },
								{ href: `/instructor/course/assets/${id}`, label: "Assets", icon: "ri-folder-2-line" },
								{ label: "Delete course", icon: "ri-delete-bin-line", danger: true, onClick: () => onDelete(id) },
							]}
						/>
					</div>
				</div>
			</div>
		</article>
	);
};

export default CoursesCard;
