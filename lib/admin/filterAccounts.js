import { accountIsActive } from "../auth/accountState.js";

// Search + Active/Inactive filter for the Admin > Students and Admin > Instructors tables.
export const filterAccounts = (list, q, status) => {
	const needle = String(q || "").trim().toLowerCase();
	return list.filter((u) => {
		if (status === "active" && !accountIsActive(u)) return false;
		if (status === "inactive" && accountIsActive(u)) return false;
		if (!needle) return true;
		return [u.first_name, u.last_name, u.email, u.phone].some((v) => String(v || "").toLowerCase().includes(needle));
	});
};
