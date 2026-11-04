// Telecaller follow-up models (tables from migrations/20261028000000-create-meeting-followups.js). No schema change: this only maps
// the existing tables. They sit BESIDE meeting_requests: the association below is declared here, and meeting_request.js is untouched.
// Used through lib/followups/repo.js.
import { Model, DataTypes } from "sequelize";
import connection from "../connection";
import { MeetingRequest } from "./meeting_request";

const base = (modelName, tableName, extra = {}) => ({ sequelize: connection, modelName, tableName, createdAt: "created_at", updatedAt: "updated_at", ...extra });
const D3 = DataTypes.DATE(3); // the columns are DATETIME(3); plain DATE would store whole seconds only
const U = DataTypes.UUID;
const S = (n) => DataTypes.STRING(n);

export const FOLLOW_UP_STATUS_VALUES = ["not_contacted", "contacted", "follow_up_required", "meeting_confirmed", "not_interested", "unable_to_reach", "completed"];

export class MeetingFollowup extends Model {}
MeetingFollowup.init(
	{
		meeting_request_id: { type: U, primaryKey: true },
		follow_up_status: { type: DataTypes.ENUM(...FOLLOW_UP_STATUS_VALUES), allowNull: false, defaultValue: "not_contacted" },
		owner_user_id: U,
		owned_at: D3,
		last_contacted_at: D3,
		next_follow_up_at: D3,
		completed_at: D3,
		completed_by: U,
		completion_note: S(500),
		version: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
		created_at: D3,
		updated_at: D3,
	},
	base("MeetingFollowup", "meeting_followups")
);

// Append-only: no updated_at, and the repository has no update or delete for it.
export class MeetingCallLog extends Model {}
MeetingCallLog.init(
	{
		id: { type: U, primaryKey: true },
		meeting_request_id: { type: U, allowNull: false },
		telecaller_user_id: U,
		telecaller_name: { type: S(120), allowNull: false },
		called_at: { type: D3, allowNull: false },
		answered: { type: DataTypes.BOOLEAN, allowNull: false },
		outcome: { type: DataTypes.ENUM("spoke_to_customer", "no_answer", "busy", "voicemail_left", "wrong_number", "call_back_requested", "other"), allowNull: false },
		interest: DataTypes.ENUM("high", "medium", "low", "none"),
		follow_up_status_after: DataTypes.ENUM(...FOLLOW_UP_STATUS_VALUES),
		notes: { type: DataTypes.TEXT, allowNull: false },
		next_follow_up_at: D3,
		confirmation_details: DataTypes.TEXT,
		created_at: D3,
	},
	base("MeetingCallLog", "meeting_call_logs", { updatedAt: false })
);

// Append-only audit of ownership changes, status changes and completion.
export class MeetingFollowupEvent extends Model {}
MeetingFollowupEvent.init(
	{
		id: { type: U, primaryKey: true },
		meeting_request_id: { type: U, allowNull: false },
		event_type: { type: DataTypes.ENUM("take", "transfer", "admin_assign", "admin_clear", "status_change", "completed"), allowNull: false },
		actor_user_id: U,
		actor_name: { type: S(120), allowNull: false },
		actor_role: { type: DataTypes.ENUM("telecaller", "admin"), allowNull: false },
		from_user_id: U,
		from_name: S(120),
		to_user_id: U,
		to_name: S(120),
		from_status: S(24),
		to_status: S(24),
		reason: S(500),
		created_at: D3,
	},
	base("MeetingFollowupEvent", "meeting_followup_events", { updatedAt: false })
);

// Read-side join only (a hasOne declared from this file; the meeting model and table are not changed).
if (!MeetingRequest.associations.followup) MeetingRequest.hasOne(MeetingFollowup, { foreignKey: "meeting_request_id", as: "followup", constraints: false });
