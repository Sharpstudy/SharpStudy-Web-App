import jwt from "jsonwebtoken";
import User from "database/models/user";
import { requireUser } from "@/lib/auth/access";
import { accountIsActive } from "@/lib/auth/accountState";
import { InstructorApplication } from "@/database/models/instructor_application";
import { ML_Guardian, ML_Learner } from "@/database/models/mastery";
import { BookOrder } from "@/database/models/book";
import Enrolment from "@/database/models/enrolment";
import { isParentOnly } from "@/lib/family/parentMode";
import { TelecallerProfile } from "@/database/models/telecaller";

export default async (req, res) => {
	if (!("authorization" in req.headers)) {
		return res.status(401).json({ message: "No autorization token" });
	}
	// Verified token AND a currently active account (a deactivated user's old token gets a 401).
	const actor = await requireUser(req, res);
	if (!actor) return;
	switch (req.method) {
		case "GET":
			await userGetById(req, res, actor);
			break;
		case "PUT":
			await userUpdate(req, res, actor);
			break;
		default:
			res.status(405).json({
				message: `Method ${req.method} not allowed`,
			});
	}
};

const userGetById = async (req, res, actor) => {
	try {
		const userId = actor.userId;

		const user = await User.findOne({
			where: { id: userId },
		});

		// Deactivated by an administrator: end the session (the client clears its cookie on any error here).
		if (user && !accountIsActive(user)) {
			return res.status(401).json({ message: "This account is disabled." });
		}

		// Status of the user's own instructor application (drives the navigation only; every
		// protected page and API re-checks the real role). Tolerates the migration not being applied yet.
		let instructor_application_status = null;
		try {
			const app = user && (await InstructorApplication.findOne({ where: { user_id: userId }, attributes: ["status"] }));
			instructor_application_status = app ? app.status : null;
		} catch (err) {
			instructor_application_status = null;
		}

		// Parent-only accounts get the restricted Progress / Family experience (lib/family/parentMode.js). Derived from
		// the database on every request; any failure (for example a table not migrated yet) means "not a parent".
		let is_parent = false;
		// A child account: a student whose account is the linked login of a learner profile. They get the student Family
		// page (their own parent link code); everyone else keeps the parent Progress dashboard. Same rule the child link
		// API uses (lib/family/links.js childLearner), computed here from the database, never from the browser.
		let is_learner_account = false;
		try {
			if (user && user.role === "student") {
				const studentLinks = await ML_Learner.count({ where: { student_user_id: userId } });
				is_learner_account = studentLinks > 0;
				is_parent = isParentOnly({
					role: user.role,
					active: accountIsActive(user),
					parentLinks: await ML_Guardian.count({ where: { user_id: userId, relation: "parent" } }),
					studentLinks,
					paidCourses: await Enrolment.count({ where: { userId, status: "paid" } }),
					paidBooks: await BookOrder.count({ where: { user_id: userId, status: "paid" } }),
				});
			}
		} catch (err) {
			is_learner_account = false;
			is_parent = false;
		}

		// Whether this account currently holds an ACTIVE approved telecaller profile (drives the telecaller screen gate and nav link only;
		// the telecaller APIs re-check it on every request). Any failure (for example the table not migrated yet) means "no access".
		let telecaller_access = null;
		try {
			if (user && user.role !== "admin" && !is_learner_account) {
				const tp = await TelecallerProfile.findByPk(userId, { attributes: ["status", "approved_at"] });
				telecaller_access = tp && tp.status === "active" && tp.approved_at ? "active" : null;
			}
		} catch (err) {
			telecaller_access = null;
		}

		res.status(200).json({ user: user ? { ...user.get({ plain: true }), instructor_application_status, is_parent, is_learner_account, telecaller_access } : user });
	} catch (e) {
		res.status(400).json({
			error_code: "get_user_by_id",
			message: e.message,
		});
	}
};

const userUpdate = async (req, res, actor) => {
	const {
		first_name,
		last_name,
		bio,
		gender,
		website,
		twitter,
		facebook,
		linkedin,
		youtube,
	} = req.body;
	try {
		const userId = actor.userId;

		await User.update(
			{
				first_name,
				last_name,
				bio,
				gender,
				website,
				twitter,
				facebook,
				linkedin,
				youtube,
			},
			{
				where: { id: userId },
			}
		);

		const updateUser = await User.findOne({
			where: { id: userId },
		});

		const edmy_users_token = jwt.sign(
			{
				userId: updateUser.id,
				first_name: updateUser.first_name,
				last_name: updateUser.last_name,
				email: updateUser.email,
				role: updateUser.role,
				avatar: updateUser.profile_photo,
			},
			process.env.JWT_SECRET,
			{
				expiresIn: "7d",
			}
		);

		res.status(200).json({
			message: "Profile updated.",
			edmy_users_token,
		});
	} catch (e) {
		res.status(400).json({
			error_code: "update_user",
			message: e.message,
		});
	}
};
