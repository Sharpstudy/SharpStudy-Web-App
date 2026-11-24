// Instructor application models (tables from migrations/20261017000000-create-instructor-applications.js).
// Used through lib/instructor-applications/repo.js.
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
const T = DataTypes.TEXT;
const S = (n) => DataTypes.STRING(n);

export const STATUS_VALUES = ["draft", "pending", "under_review", "more_info_requested", "approved", "rejected", "revoked"];

export class InstructorApplication extends Model {}
InstructorApplication.init(
	{
		id,
		user_id: { type: DataTypes.UUID, allowNull: false },
		status: { type: DataTypes.ENUM(...STATUS_VALUES), defaultValue: "draft" },
		attempt: { type: DataTypes.INTEGER, defaultValue: 1 },
		version: { type: DataTypes.INTEGER, defaultValue: 0 },
		full_name: S(120),
		phone: S(40),
		country: S(80),
		location: S(120),
		education_level: S(40),
		degree: S(160),
		institution: S(160),
		graduation_year: DataTypes.INTEGER,
		certifications: T,
		profession: S(120),
		has_teaching_experience: DataTypes.BOOLEAN,
		teaching_years: DataTypes.INTEGER,
		teaching_modes: DataTypes.JSON,
		student_levels: DataTypes.JSON,
		prior_experience: T,
		subjects: DataTypes.JSON,
		topics: T,
		languages: S(200),
		expertise_notes: T,
		sample_kind: DataTypes.ENUM("video", "document", "lesson_plan"),
		sample_url: S(500),
		sample_title: S(160),
		sample_outline: T,
		methodology: T,
		material_url: S(500),
		motivation: T,
		agreed_policies: { type: DataTypes.BOOLEAN, defaultValue: false },
		consented_privacy: { type: DataTypes.BOOLEAN, defaultValue: false },
		admin_notes: T,
		rubric: DataTypes.JSON,
		applicant_feedback: T,
		submitted_at: DataTypes.DATE,
		reviewed_by: DataTypes.UUID,
		reviewed_at: DataTypes.DATE,
		decided_at: DataTypes.DATE,
		reapply_after: DataTypes.DATE,
		notify_kind: S(32),
		notify_status: { type: DataTypes.ENUM("none", "pending", "sent", "failed", "skipped"), defaultValue: "none" },
		notify_error: S(300),
	},
	opts("InstructorApplication", "instructor_applications")
);

export class InstructorApplicationEvent extends Model {}
InstructorApplicationEvent.init(
	{
		id,
		application_id: { type: DataTypes.UUID, allowNull: false },
		from_status: S(24),
		to_status: { type: S(24), allowNull: false },
		actor: { type: S(12), allowNull: false },
		actor_user_id: DataTypes.UUID,
		feedback: T,
		internal_note: T,
	},
	opts("InstructorApplicationEvent", "instructor_application_events")
);

export class InstructorProfile extends Model {}
InstructorProfile.init(
	{
		user_id: { type: DataTypes.UUID, primaryKey: true },
		qualifications: T,
		languages: S(200),
		subjects: S(300),
		experience: T,
	},
	opts("InstructorProfile", "instructor_profiles")
);
