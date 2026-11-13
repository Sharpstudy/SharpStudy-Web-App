import React from "react";
import ActionMenu from "@/components/ui/ActionMenu";
import { StatusBadge } from "./useAccountManager";
import { orNA } from "@/lib/admin/instructorList";

// One row of Admin > Instructors: an account that currently HAS instructor access.
// `phone`, `subject` and `about` come from /api/instructor/instructors (see lib/admin/instructorList.js);
// a genuinely empty value reads "N/A".
const InstructorRow = ({ first_name, last_name, email, phone, subject, about, status, menuItems = [] }) => (
	<tr>
		<td>{`${first_name || ""} ${last_name || ""}`.trim()}</td>
		<td>{email}</td>
		<td className="text-nowrap">{orNA(phone)}</td>
		<td>{orNA(subject)}</td>
		<td>
			<div className="max-300px max-height-60">{orNA(about)}</div>
		</td>
		<td>
			<StatusBadge user={{ status }} />
		</td>
		<td>
			<ActionMenu label={`Actions for ${first_name || ""} ${last_name || ""}`.trim()} items={menuItems} />
		</td>
	</tr>
);

export default InstructorRow;
