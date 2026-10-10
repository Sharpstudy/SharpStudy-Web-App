import React, { useState } from "react";
import CourseOverview from "../Learning/CourseOverview";
import Requirements from "../Course/Requirements";
import WhoIsThisCourseFor from "../Course/WhoIsThisCourseFor";
import CourseVideo from "../Course/CourseVideo";

const TabContent = ({
	overview,
	courseSlug,
	requirements,
	is_class,
	instructor,
	who_is_this_course_for,
}) => {
	const [tab, setTab] = useState("overview");
	return (
		<>
			<div className="ss-tabs" role="tablist" aria-label="Course details">
				{[
					{ id: "overview", label: "Overview" },
					{ id: "requirements", label: "Requirements" },
					{ id: "witcf", label: "Who this course is for" },
				].map((t) => (
					<button
						key={t.id}
						type="button"
						role="tab"
						aria-selected={tab == t.id}
						onClick={() => setTab(t.id)}
					>
						{t.label}
					</button>
				))}
			</div>

			<div className="tab-content ss-rich" role="tabpanel">
				{tab === "overview" && <CourseOverview overview={overview} />}
				{!is_class && (
					<>
						{tab === "overview" && (
							<CourseVideo courseSlug={courseSlug} />
						)}
					</>
				)}
				{tab === "requirements" && (
					<Requirements requirements={requirements} />
				)}
				{tab === "witcf" && (
					<WhoIsThisCourseFor
						who_is_this_course_for={who_is_this_course_for}
					/>
				)}
			</div>
		</>
	);
};

export default TabContent;
