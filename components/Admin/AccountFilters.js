import React from "react";
import { filterAccounts } from "@/lib/admin/filterAccounts";

export { filterAccounts };

// Search box + status filter shared by Admin > Students and Admin > Instructors.
const AccountFilters = ({ q, status, onQ, onStatus }) => (
	<div className="d-flex flex-wrap gap-2 mb-3">
		<input
			type="search"
			className="form-control"
			style={{ maxWidth: 320 }}
			placeholder="Search name, email or phone"
			aria-label="Search accounts"
			value={q}
			onChange={(e) => onQ(e.target.value)}
		/>
		<select className="form-select" style={{ maxWidth: 180 }} aria-label="Filter by status" value={status} onChange={(e) => onStatus(e.target.value)}>
			<option value="">All statuses</option>
			<option value="active">Active</option>
			<option value="inactive">Inactive</option>
		</select>
	</div>
);

export default AccountFilters;
