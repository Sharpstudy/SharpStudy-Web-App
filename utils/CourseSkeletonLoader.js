import React from "react";
import Skeleton from "react-loading-skeleton";

// Fluid placeholder grid matching the course card layout.
const CourseSkeletonLoader = ({ count = 4 }) => (
	<div className="ss-grid ss-grid--cards" aria-busy="true" aria-label="Loading courses">
		{Array.from({ length: count }).map((_, i) => (
			<div className="ss-course-card" key={i}>
				<div className="ss-course-card__media">
					<Skeleton height="100%" style={{ display: "block" }} borderRadius={0} />
				</div>
				<div className="ss-course-card__body">
					<Skeleton height={20} width="80%" />
					<Skeleton count={2} height={12} />
					<Skeleton height={32} style={{ marginTop: 12 }} />
				</div>
			</div>
		))}
	</div>
);

export default CourseSkeletonLoader;
