// SQL for comparing phone numbers regardless of spaces, dashes, dots and brackets (same on MySQL and PostgreSQL). Used by the meeting and
// follow-up repositories; nothing is rewritten in the database.
import { Op, fn, col } from "sequelize";
import { phoneKeys, phoneSearchTerm } from "./phoneKey.js";

const stripped = () => fn("replace", fn("replace", fn("replace", fn("replace", fn("replace", col("MeetingRequest.phone"), " ", ""), "-", ""), ".", ""), "(", ""), ")", "");

// WHERE condition: the stored phone is the same number as `phone` (any spelling)
export const phoneIs = (sequelize, phone) => sequelize.where(stripped(), { [Op.in]: phoneKeys(phone) });
// WHERE condition for a search box entry that looks like a phone number; null when it does not
export const phoneSearch = (sequelize, like, q) => {
	const term = phoneSearchTerm(q);
	return term ? sequelize.where(stripped(), { [like]: `%${term.replace(/[\%_]/g, (c) => `\${c}`)}%` }) : null;
};
