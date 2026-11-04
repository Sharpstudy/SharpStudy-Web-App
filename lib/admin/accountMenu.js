import { accountIsActive } from "../auth/accountState.js";
import { isAnonymized } from "./anonymized.js";

// The Actions menu for one row of Admin > Students / Instructors. Which actions appear depends on the
// account's current state; the server re-validates every action, so this is presentation only.
//   active      -> View Details, Deactivate Account, Anonymize Account
//   inactive    -> View Details, Reactivate Account, Anonymize Account
//   anonymized  -> View Details only (nothing is left to manage)
//   admin       -> View Details only (administrators are managed from the Admins page)
export function accountMenuItems(user, on) {
	// An instructor has a dedicated details page; other accounts open the details dialog.
	const view =
		user.role === "instructor"
			? { key: "view", label: "View Details", icon: "ri-eye-line", href: `/admin/instructor/${user.id}/` }
			: { key: "view", label: "View Details", icon: "ri-eye-line", onClick: () => on.view(user) };
	const items = [view];
	if (user.role === "admin" || isAnonymized(user)) return items;
	items.push(
		accountIsActive(user)
			? { key: "deactivate", label: "Deactivate Account", icon: "ri-pause-circle-line", onClick: () => on.deactivate(user) }
			: { key: "reactivate", label: "Reactivate Account", icon: "ri-play-circle-line", onClick: () => on.reactivate(user) }
	);
	items.push({ key: "anonymize", label: "Anonymize Account", icon: "ri-user-unfollow-line", danger: true, onClick: () => on.anonymize(user) });
	return items;
}
