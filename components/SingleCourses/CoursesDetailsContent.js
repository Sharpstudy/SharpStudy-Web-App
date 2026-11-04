import React from "react";
import Link from "next/link";
import CoursesDetailsSidebar from "./CoursesDetailsSidebar";
import WhatYouWillLearn from "../Course/WhatYouWillLearn";
import InstructorProfile from "../Course/InstructorProfile";
import { formatDate, plural } from "@/utils/helper";
import TabContent from "./TabContent";

const CoursesDetailsContent = ({ user: current_user, course }) => {
	const {
		title,
		short_desc,
		slug,
		overview,
		what_you_will_learn,
		who_is_this_course_for,
		requirements,
		is_class,
		updated_at,
		category,
		user,
		enrolments,
	} = course;

	return (
		<>
			<section className="ss-course-hero">
				<div className="ss-container ss-container--wide">
					<nav aria-label="Breadcrumb">
						<ol className="ss-breadcrumb">
							<li>
								<Link href="/courses/">
									<a>Courses</a>
								</Link>
							</li>
							{category && (
								<li>
									<Link href={`/category/${category.slug}`}>
										<a className="text-capitalize">{category.name}</a>
									</Link>
								</li>
							)}
							<li aria-current="page">{title}</li>
						</ol>
					</nav>
					<div className="ss-course-hero__main">
						<h1>{title}</h1>
						{short_desc && <p className="ss-course-hero__lead">{short_desc}</p>}
						<ul className="ss-course-hero__meta">
							{is_class && (
								<li>
									<span className="ss-badge ss-badge--accent">
										<i className="ri-live-line" aria-hidden="true"></i> Live class
									</span>
								</li>
							)}
							<li>
								<i className="ri-group-line" aria-hidden="true"></i>
								{plural(enrolments ? enrolments.length : 0, "student")}
							</li>
							{updated_at && (
								<li>
									<i className="ri-refresh-line" aria-hidden="true"></i>
									Updated {formatDate(updated_at)}
								</li>
							)}
						</ul>
						{user && <InstructorProfile instructor={user} />}
					</div>
				</div>
			</section>

			<div className="ss-container ss-container--wide ss-course-body">
				<div className="ss-course-body__main">
					{what_you_will_learn && <WhatYouWillLearn what_you_will_learn={what_you_will_learn} />}
					<TabContent
						overview={overview}
						courseSlug={slug}
						requirements={requirements}
						instructor={user}
						who_is_this_course_for={who_is_this_course_for}
						is_class={is_class}
					/>
				</div>
				<CoursesDetailsSidebar current_user={current_user} course={course} />
			</div>
		</>
	);
};

export default CoursesDetailsContent;
