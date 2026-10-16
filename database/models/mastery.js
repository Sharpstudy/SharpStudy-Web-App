// Mastery Ladder models (tables created by
// migrations/20261012000000-create-mastery-ladder.js). Kept in one module
// because they are only used together, through lib/mastery-server/repo.js.
import { Model, DataTypes } from "sequelize";
import connection from "../connection";

const opts = (modelName, tableName) => ({
	sequelize: connection,
	modelName,
	tableName,
	createdAt: "created_at",
	updatedAt: "updated_at",
});
const id = { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true };
const learnerId = { type: DataTypes.UUID, allowNull: false };

// JSON columns: MySQL returns JSON, but some drivers/hosts hand back strings.
const json = (name) => ({
	type: DataTypes.JSON,
	get() {
		const v = this.getDataValue(name);
		if (typeof v === "string") {
			try {
				return JSON.parse(v);
			} catch (e) {
				return v;
			}
		}
		return v;
	},
});

export class ML_Learner extends Model {}
ML_Learner.init(
	{
		id,
		owner_user_id: { type: DataTypes.UUID, allowNull: false },
		display_name: { type: DataTypes.STRING(40), allowNull: false },
		avatar: DataTypes.STRING(16),
		birth_year: DataTypes.INTEGER,
		student_user_id: DataTypes.UUID, // explicit link to an account student (see lib/mastery/studentLinks.js)
		grade: DataTypes.STRING(4), // LKG, UKG, C1..C7
		birth_date: DataTypes.DATEONLY, // private: adults only; age is derived from it
		contact_name: DataTypes.STRING(80),
		contact_phone: DataTypes.STRING(32),
		contact_email: DataTypes.STRING(120),
		pin_hash: { type: DataTypes.STRING(100), allowNull: false },
		pin_failed_attempts: { type: DataTypes.INTEGER, defaultValue: 0 },
		pin_locked_until: DataTypes.DATE,
		adult_mode: { type: DataTypes.BOOLEAN, defaultValue: false },
		adult_mode_set_by: DataTypes.UUID,
		daily_goal: { type: DataTypes.INTEGER, defaultValue: 1 },
		time_zone: { type: DataTypes.STRING(64), defaultValue: "UTC" },
		reminder_time: DataTypes.STRING(5),
		last_seen_at: DataTypes.DATE,
	},
	opts("ML_Learner", "ml_learners")
);

export class ML_Guardian extends Model {}
ML_Guardian.init(
	{
		id,
		learner_id: learnerId,
		user_id: { type: DataTypes.UUID, allowNull: false },
		relation: { type: DataTypes.ENUM("parent", "instructor"), allowNull: false },
		created_by: DataTypes.UUID,
	},
	opts("ML_Guardian", "ml_learner_guardians")
);

export class ML_Enrolment extends Model {}
ML_Enrolment.init(
	{ id, learner_id: learnerId, subject: DataTypes.STRING(16), active: DataTypes.BOOLEAN },
	opts("ML_Enrolment", "ml_subject_enrolments")
);

export class ML_Progress extends Model {}
ML_Progress.init(
	{
		id,
		learner_id: learnerId,
		subject: DataTypes.STRING(16),
		level_id: DataTypes.STRING(8),
		set_id: DataTypes.STRING(12),
		worksheet_no: DataTypes.INTEGER,
		version: { type: DataTypes.INTEGER, defaultValue: 1 },
		updated_by: DataTypes.STRING(80),
	},
	opts("ML_Progress", "ml_progress")
);

export class ML_Attempt extends Model {}
ML_Attempt.init(
	{
		id,
		learner_id: learnerId,
		client_attempt_id: { type: DataTypes.STRING(64), allowNull: false },
		session_id: DataTypes.STRING(64),
		subject: DataTypes.STRING(16),
		level_id: DataTypes.STRING(8),
		set_id: DataTypes.STRING(12),
		worksheet_no: DataTypes.INTEGER,
		variant: DataTypes.INTEGER,
		seed: DataTypes.STRING(80),
		total: DataTypes.INTEGER,
		correct_first: DataTypes.INTEGER,
		accuracy: DataTypes.FLOAT,
		duration_ms: DataTypes.INTEGER,
		target_seconds: DataTypes.INTEGER,
		stars: DataTypes.INTEGER,
		status: DataTypes.STRING(16),
		outcome: DataTypes.STRING(24),
		counted: DataTypes.BOOLEAN,
		hints_used: DataTypes.INTEGER,
		responses: json("responses"),
		started_at: DataTypes.DATE,
		completed_at: DataTypes.DATE,
		local_date: DataTypes.DATEONLY,
	},
	opts("ML_Attempt", "ml_attempts")
);

export class ML_DailyActivity extends Model {}
ML_DailyActivity.init(
	{
		id,
		learner_id: learnerId,
		local_date: DataTypes.DATEONLY,
		worksheets: DataTypes.INTEGER,
		stars: DataTypes.INTEGER,
		seconds: DataTypes.INTEGER,
	},
	opts("ML_DailyActivity", "ml_daily_activity")
);

export class ML_HintEvent extends Model {}
ML_HintEvent.init(
	{ id, learner_id: learnerId, session_id: DataTypes.STRING(64), question_index: DataTypes.INTEGER, mode: DataTypes.STRING(16) },
	opts("ML_HintEvent", "ml_hint_events")
);

export class ML_AuditLog extends Model {}
ML_AuditLog.init(
	{
		id,
		actor_user_id: DataTypes.UUID,
		actor_learner_id: DataTypes.UUID,
		learner_id: DataTypes.UUID,
		action: DataTypes.STRING(64),
		details: json("details"),
		ip: DataTypes.STRING(64),
	},
	opts("ML_AuditLog", "ml_audit_logs")
);

export class ML_Feedback extends Model {}
ML_Feedback.init(
	{
		id,
		user_id: DataTypes.UUID,
		learner_id: DataTypes.UUID,
		message: DataTypes.TEXT,
		page: DataTypes.STRING(200),
		screenshot: DataTypes.TEXT("medium"),
		status: { type: DataTypes.ENUM("new", "reviewing", "resolved"), defaultValue: "new" },
		admin_note: DataTypes.TEXT,
	},
	opts("ML_Feedback", "ml_feedback")
);

export class ML_Setting extends Model {}
ML_Setting.init(
	{ key: { type: DataTypes.STRING(64), primaryKey: true }, value: json("value"), updated_by: DataTypes.UUID },
	opts("ML_Setting", "ml_settings")
);

export class ML_Role extends Model {}
ML_Role.init(
	{ id, name: DataTypes.STRING(60), description: DataTypes.STRING(255), permissions: json("permissions") },
	opts("ML_Role", "ml_roles")
);

export class ML_UserRole extends Model {}
ML_UserRole.init({ id, user_id: DataTypes.UUID, role_id: DataTypes.UUID }, opts("ML_UserRole", "ml_user_roles"));

export class ML_Presence extends Model {}
ML_Presence.init(
	{
		id,
		kind: DataTypes.ENUM("user", "learner"),
		subject_id: DataTypes.UUID,
		path: DataTypes.STRING(200),
		last_seen_at: DataTypes.DATE,
	},
	opts("ML_Presence", "ml_presence")
);

// An instructor's assignment of one existing worksheet to one or more learners.
export class ML_Assignment extends Model {}
ML_Assignment.init(
	{
		id,
		created_by: { type: DataTypes.UUID, allowNull: false },
		course_id: DataTypes.UUID,
		title: { type: DataTypes.STRING(160), allowNull: false },
		subject: { type: DataTypes.STRING(16), allowNull: false },
		level_id: { type: DataTypes.STRING(32), allowNull: false },
		set_id: { type: DataTypes.STRING(40), allowNull: false },
		worksheet_no: { type: DataTypes.INTEGER, allowNull: false },
		grade: DataTypes.STRING(4),
		group_label: DataTypes.STRING(80),
		instructions: DataTypes.TEXT,
		due_at: DataTypes.DATE,
		status: { type: DataTypes.ENUM("active", "cancelled"), defaultValue: "active" },
	},
	opts("ML_Assignment", "ml_assignments")
);

// One row per (assignment, learner): start / completion, pointing at the graded attempt.
export class ML_AssignmentTarget extends Model {}
ML_AssignmentTarget.init(
	{
		id,
		assignment_id: { type: DataTypes.UUID, allowNull: false },
		learner_id: learnerId,
		started_at: DataTypes.DATE,
		attempt_id: DataTypes.UUID,
		completed_at: DataTypes.DATE,
	},
	opts("ML_AssignmentTarget", "ml_assignment_targets")
);
