// Meeting-request models (tables from migrations/20261015000000-create-meeting-requests.js).
// Used through lib/meetings/repo.js.
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

export class MeetingRequest extends Model {}
MeetingRequest.init(
	{
		id,
		reference: { type: DataTypes.STRING(20), allowNull: false },
		manage_token_hash: { type: DataTypes.CHAR(64), allowNull: false },
		submission_key: DataTypes.STRING(64),
		name: { type: DataTypes.STRING(120), allowNull: false },
		email: { type: DataTypes.STRING(200), allowNull: false },
		phone: { type: DataTypes.STRING(40), allowNull: false },
		organization: DataTypes.STRING(160),
		purpose: { type: DataTypes.ENUM("product_demo", "course_inquiry", "partnership", "technical_support", "other"), allowNull: false },
		message: DataTypes.TEXT,
		requested_date: { type: DataTypes.DATEONLY, allowNull: false },
		requested_time: { type: DataTypes.CHAR(5), allowNull: false },
		time_zone: { type: DataTypes.STRING(64), allowNull: false },
		requested_at: { type: DataTypes.DATE, allowNull: false },
		status: { type: DataTypes.ENUM("pending", "approved", "rejected", "reschedule_requested", "cancelled"), defaultValue: "pending" },
		duration_minutes: { type: DataTypes.INTEGER, defaultValue: 30 },
		confirmed_start: DataTypes.DATE,
		confirmed_end: DataTypes.DATE,
		proposed_start: DataTypes.DATE,
		meeting_url: DataTypes.STRING(500),
		admin_notes: DataTypes.TEXT,
		processed_by: DataTypes.UUID,
		processed_at: DataTypes.DATE,
		version: { type: DataTypes.INTEGER, defaultValue: 0 },
		admin_email_status: { type: DataTypes.ENUM("pending", "sent", "failed", "skipped"), defaultValue: "pending" },
		visitor_email_status: { type: DataTypes.ENUM("pending", "sent", "failed", "skipped"), defaultValue: "pending" },
		last_email_error: DataTypes.STRING(300),
	},
	opts("MeetingRequest", "meeting_requests")
);

export class MeetingRequestEvent extends Model {}
MeetingRequestEvent.init(
	{
		id,
		meeting_request_id: { type: DataTypes.UUID, allowNull: false },
		from_status: DataTypes.STRING(24),
		to_status: { type: DataTypes.STRING(24), allowNull: false },
		actor: { type: DataTypes.STRING(20), allowNull: false },
		actor_user_id: DataTypes.UUID,
		note: DataTypes.STRING(500),
	},
	opts("MeetingRequestEvent", "meeting_request_events")
);
