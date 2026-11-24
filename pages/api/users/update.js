import jwt from "jsonwebtoken";
import User from "database/models/user";
import { requireUser } from "@/lib/auth/access";
import { accountIsActive } from "@/lib/auth/accountState";
import { InstructorApplication } from "@/database/models/instructor_application";
import { ML_Guardian, ML_Learner } from "@/database/models/mastery";
import { BookOrder } from "@/database/models/book";
import Enrolment from "@/database/models/enrolment";
import { isParentOnly } from "@/lib/family/parentMode";
import { TelecallerProfile, TelecallerApplication } from "@/database/models/telecaller";
import { telecallerState } from "@/lib/auth/telecallerState";

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

		// Everything below depends only on the user id (and, for the student-only counts, on the role read above), so the look-ups run
		// concurrently: one round-trip of latency instead of up to seven. Each keeps its own failure tolerance, exactly as before
		// (a table that is not migrated yet means "no" rather than an error). Results and rules are unchanged.
		const tolerant = (promise, fallback) => promise.catch(() => fallback);
		const isStudent = !!user && user.role === "student";
		const [appRow, studentLinks, parentLinks, paidCourses, paidBooks, tp, tApp] = await Promise.all([
			// Status of the user's own instructor application (drives the navigation only; every protected page and API re-checks the real role).
			user ? tolerant(InstructorApplication.findOne({ where: { user_id: userId }, attributes: ["status"] }), null) : null,
			// A child account: a student whose account is the linked login of a learner profile (same rule as lib/family/links.js childLearner).
			isStudent ? tolerant(ML_Learner.count({ where: { student_user_id: userId } }), null) : null,
			isStudent ? tolerant(ML_Guardian.count({ where: { user_id: userId, relation: "parent" } }), null) : null,
			isStudent ? tolerant(Enrolment.count({ where: { userId, status: "paid" } }), null) : null,
			isStudent ? tolerant(BookOrder.count({ where: { user_id: userId, status: "paid" } }), null) : null,
			// Whether this account holds an ACTIVE approved telecaller profile (drives the telecaller gate and nav link only; the telecaller APIs
			// re-check it on every request). Fetched alongside the rest and ignored below for administrators and child accounts, as before.
			user && user.role !== "admin" ? tolerant(TelecallerProfile.findByPk(userId, { attributes: ["status", "approved_at"] }), null) : null,
			// The person's own telecaller application status (drives the account state below; every telecaller API re-checks it).
			user && user.role !== "admin" ? tolerant(TelecallerApplication.findOne({ where: { user_id: userId }, attributes: ["status"] }), null) : null,
		]);
		const instructor_application_status = appRow ? appRow.status : null;

		// Parent-only accounts get the restricted Progress / Family experience (lib/family/parentMode.js), derived from the database on every
		// request; any failure of the counts above means "not a parent" (a null count aborts the derivation, as the old try/catch did).
		let is_parent = false;
		let is_learner_account = false;
		if (isStudent && [studentLinks, parentLinks, paidCourses, paidBooks].every((n) => n !== null)) {
			is_learner_account = studentLinks > 0;
			is_parent = isParentOnly({
				role: user.role,
				active: accountIsActive(user),
				parentLinks,
				studentLinks,
				paidCourses,
				paidBooks,
			});
		} else {
			// not a student, or one of the counts failed: not a parent and not a child account
			is_learner_account = false;
			is_parent = false;
		}

		let telecaller_access = null;
		if (user && user.role !== "admin" && !is_learner_account) {
			telecaller_access = tp && tp.status === "active" && tp.approved_at ? "active" : null;
		}

		// The full telecaller account state (none / draft / pending / more_info / rejected / active / inactive). Computed here from the database,
		// never from the browser, and used by the page gate, the landing redirect and the navigation. `telecaller_access` stays as before.
		const telecaller_state = user ? telecallerState({ role: user.role, isLearner: is_learner_account, applicationStatus: tApp ? tApp.status : null, profileStatus: tp ? tp.status : null, approvedAt: tp ? tp.approved_at : null }) : "none";

		res.status(200).json({ user: user ? { ...user.get({ plain: true }), instructor_application_status, is_parent, is_learner_account, telecaller_access, telecaller_state } : user });
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
