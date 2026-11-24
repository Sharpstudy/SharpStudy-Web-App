// Telecaller application models (tables from migrations/20261027000000-create-telecaller-applications.js).
// Used through lib/telecallers/repo.js. users.role is never part of this: an approved telecaller is a user with an
// ACTIVE row in telecaller_profiles.
import { Model, DataTypes } from "sequelize";
import connection from "../connection";

const base = (modelName, tableName, extra = {}) => ({ sequelize: connection, modelName, tableName, createdAt: "created_at", updatedAt: "updated_at", ...extra });
const id = { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true };
const T = DataTypes.TEXT;
const S = (n) => DataTypes.STRING(n);
// The columns are DATETIME(3). A model that declares plain DataTypes.DATE makes Sequelize write whole seconds only, which
// loses the order of events and resume versions created within the same second, so every timestamp here is DATE(3).
const D3 = DataTypes.DATE(3);
const stamps = { created_at: D3, updated_at: D3 };

export const STATUS_VALUES = ["draft", "pending", "more_info_requested", "approved", "rejected"];

export class TelecallerApplication extends Model {}
TelecallerApplication.init(
	{
		id,
		user_id: { type: DataTypes.UUID, allowNull: false },
		status: { type: DataTypes.ENUM(...STATUS_VALUES), defaultValue: "draft" },
		attempt: { type: DataTypes.INTEGER, defaultValue: 1 },
		full_name: S(120),
		phone: S(40),
		city: S(80),
		state: S(80),
		qualification: DataTypes.ENUM("high_school", "diploma", "bachelor", "master", "doctorate", "other"),
		has_telecalling_experience: DataTypes.BOOLEAN,
		experience_years: DataTypes.INTEGER,
		previous_company: S(160),
		languages: S(300),
		employment_preference: DataTypes.ENUM("full_time", "part_time"),
		additional_info: T,
		confirmed_adult: { type: DataTypes.BOOLEAN, defaultValue: false },
		consented_privacy: { type: DataTypes.BOOLEAN, defaultValue: false },
		consented_at: D3,
		feedback: T,
		admin_notes: T,
		submitted_at: D3,
		decided_at: D3,
		decided_by: DataTypes.UUID,
		version: { type: DataTypes.INTEGER, defaultValue: 0 },
		...stamps,
	},
	base("TelecallerApplication", "telecaller_applications")
);

// Append-only: no updated_at. The only column ever written after insert is the e-mail delivery bookkeeping (email_status).
export class TelecallerApplicationEvent extends Model {}
TelecallerApplicationEvent.init(
	{
		id,
		application_id: { type: DataTypes.UUID, allowNull: false },
		attempt: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
		from_status: S(24),
		to_status: { type: S(24), allowNull: false },
		actor: { type: DataTypes.ENUM("applicant", "admin", "system"), allowNull: false },
		actor_user_id: DataTypes.UUID,
		feedback: T,
		internal_note: T,
		// The applicant's complete submitted form (migration 20261029000000). Written once, with the submit event; never
		// updated. NULL on every other event and on events from before the column existed.
		form_snapshot: DataTypes.JSON,
		email_status: { type: DataTypes.ENUM("none", "sent", "skipped", "failed"), defaultValue: "none" },
		created_at: D3,
	},
	base("TelecallerApplicationEvent", "telecaller_application_events", { updatedAt: false })
);

// Immutable resume versions. The file bytes (`data`) are excluded from every default query; only the admin-only
// download reads them, through TelecallerResume.unscoped().
export class TelecallerResume extends Model {}
TelecallerResume.init(
	{
		id,
		application_id: { type: DataTypes.UUID, allowNull: false },
		attempt: { type: DataTypes.INTEGER, allowNull: false },
		original_filename: { type: S(200), allowNull: false },
		mime_type: { type: S(100), allowNull: false },
		size_bytes: { type: DataTypes.INTEGER, allowNull: false },
		sha256: { type: DataTypes.CHAR(64), allowNull: false },
		data: { type: DataTypes.BLOB("medium"), allowNull: false },
		uploaded_at: D3,
	},
	base("TelecallerResume", "telecaller_resumes", { createdAt: "uploaded_at", updatedAt: false, defaultScope: { attributes: { exclude: ["data"] } } })
);

export class TelecallerProfile extends Model {}
TelecallerProfile.init(
	{
		user_id: { type: DataTypes.UUID, primaryKey: true },
		application_id: DataTypes.UUID,
		status: { type: DataTypes.ENUM("active", "inactive"), defaultValue: "active" },
		approved_at: D3,
		approved_by: DataTypes.UUID,
		status_changed_at: D3,
		status_changed_by: DataTypes.UUID,
		status_reason: S(300),
		version: { type: DataTypes.INTEGER, defaultValue: 0 },
		...stamps,
	},
	base("TelecallerProfile", "telecaller_profiles")
);
