import User from "database/models/user";
import { InstructorProfile } from "@/database/models/instructor_application";

const USER_ATTRS = ["first_name", "last_name", "email", "designation", "bio", "profile_photo", "location", "website", "linkedin", "phone"];

const profileRepo = {
	async getUser(id) {
		const u = await User.findByPk(id, { attributes: USER_ATTRS });
		return u ? u.get({ plain: true }) : null;
	},
	async getProfile(id) {
		const p = await InstructorProfile.findByPk(id);
		return p ? p.get({ plain: true }) : null;
	},
	async updateUser(id, patch) {
		await User.update(patch, { where: { id } });
	},
	// One row per user (user_id is the primary key): create it, or update only the fields that were sent.
	async upsertProfile(id, patch) {
		const [row, created] = await InstructorProfile.findOrCreate({ where: { user_id: id }, defaults: patch });
		if (!created) await row.update(patch);
	},
};

export default profileRepo;
