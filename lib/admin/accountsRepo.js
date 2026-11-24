// Sequelize-backed repo for lib/admin/accounts.js. Read-only counts plus single-row updates of `users`.
import { v4 as uuidv4 } from "uuid";
import { User, Course, Enrolment, Course_Progress, Instructor_Earning } from "database/models";
import { ML_Learner, ML_Assignment, ML_AuditLog } from "database/models/mastery";
import { BookOrder } from "database/models/book";

// A table that is not migrated yet must not break the details screen.
const count = async (p) => {
	try {
		return await p;
	} catch (e) {
		return null;
	}
};

const accountsRepo = {
	async getUser(id) {
		const u = await User.findByPk(id);
		return u ? u.get({ plain: true }) : null;
	},
	async updateUser(id, patch) {
		await User.update(patch, { where: { id }, limit: 1 });
	},
	async relatedCounts(id) {
		const [enrolments, paidEnrolments, progressRecords, coursesOwned, earnings, bookOrders, learnerProfiles, assignmentsCreated] = await Promise.all([
			count(Enrolment.count({ where: { userId: id } })),
			count(Enrolment.count({ where: { userId: id, status: "paid" } })),
			count(Course_Progress.count({ where: { userId: id } })),
			count(Course.count({ where: { userId: id } })),
			count(Instructor_Earning.count({ where: { userId: id } })),
			count(BookOrder.count({ where: { user_id: id } })),
			count(ML_Learner.count({ where: { owner_user_id: id } })),
			count(ML_Assignment.count({ where: { created_by: id } })),
		]);
		return { enrolments, paidEnrolments, progressRecords, coursesOwned, earnings, bookOrders, learnerProfiles, assignmentsCreated };
	},
	async audit(row) {
		await ML_AuditLog.create({ id: uuidv4(), ...row });
	},
};

export default accountsRepo;
