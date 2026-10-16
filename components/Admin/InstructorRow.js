import React from "react";

// One row of Admin > Instructors: an account that currently HAS instructor access.
const InstructorRow = ({ first_name, last_name, email, phone, instructor_subject, instructor_description }) => (
	<tr>
		<td>{`${first_name || ""} ${last_name || ""}`.trim()}</td>
		<td>{email}</td>
		<td>{phone}</td>
		<td>{instructor_subject}</td>
		<td>
			<div className="max-300px max-height-60">{instructor_description}</div>
		</td>
		<td>
			<span className="ss-badge ss-badge--success">Instructor</span>
		</td>
	</tr>
);

export default InstructorRow;
