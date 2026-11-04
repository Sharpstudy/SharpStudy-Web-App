import React from "react";

// The original linked to /instructor, which has no page (404), so the
// instructor is shown without a link.
const InstructorProfile = ({ instructor }) => {
	const { first_name, last_name, profile_photo } = instructor;
	return (
		<div className="ss-instructor">
			{/* eslint-disable-next-line @next/next/no-img-element */}
			<img
				className="ss-avatar"
				src={profile_photo ? profile_photo : "/images/admin/admin-10.jpg"}
				alt=""
			/>
			<span>
				<span className="ss-muted">Created by</span>{" "}
				<strong className="text-capitalize">
					{first_name} {last_name}
				</strong>
			</span>
		</div>
	);
};

export default InstructorProfile;
