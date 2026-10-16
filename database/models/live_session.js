// Scheduled live sessions (tables lc_classes / lc_enrolments / lc_attendance,
// see migrations 20261013000000 and 20261018000000). Used through
// lib/live-sessions/repo.js.
import { Model, DataTypes } from "sequelize";
import connection from "../connection";

const opts = (modelName, tableName) => ({
	sequelize: connection,
	modelName,
	tableName,
	createdAt: "created_at",
	updatedAt: "updated_at",
});
const id = { type: DataTypes.CHAR(36).BINARY, primaryKey: true };
const uuidRef = (allowNull = true) => ({ type: DataTypes.CHAR(36).BINARY, allowNull });

export class LiveSession extends Model {}
LiveSession.init(
	{
		id,
		instructor_id: uuidRef(false),
		title: { type: DataTypes.STRING(160), allowNull: false },
		description: DataTypes.TEXT,
		subject: { type: DataTypes.STRING(80), allowNull: false },
		course_id: uuidRef(true),
		start_at: { type: DataTypes.DATE(3), allowNull: false },
		end_at: { type: DataTypes.DATE(3), allowNull: false },
		time_zone: { type: DataTypes.STRING(64), allowNull: false },
		provider: { type: DataTypes.ENUM("jitsi", "external"), defaultValue: "jitsi" },
		meeting_url: DataTypes.STRING(500),
		room_name: { type: DataTypes.STRING(80), allowNull: false },
		status: { type: DataTypes.ENUM("scheduled", "live", "completed", "cancelled"), defaultValue: "scheduled" },
		started_at: DataTypes.DATE(3),
		ended_at: DataTypes.DATE(3),
		cancelled_at: DataTypes.DATE(3),
		session_type: { type: DataTypes.ENUM("group", "one_to_one"), defaultValue: "group" },
		capacity: { type: DataTypes.INTEGER, defaultValue: 30 },
		// "open": eligible students book their own seat. "assigned": the instructor chose the students.
		enrollment_mode: { type: DataTypes.ENUM("open", "assigned"), defaultValue: "open" },
	},
	opts("LiveSession", "lc_classes")
);

// A seat: a student holding a place in a session (a booking for one_to_one).
export class LiveSessionSeat extends Model {}
LiveSessionSeat.init(
	{
		id,
		class_id: uuidRef(false),
		participant_key: { type: DataTypes.STRING(64), allowNull: false },
		user_id: uuidRef(true),
		learner_id: uuidRef(true),
		display_name: { type: DataTypes.STRING(120), allowNull: false },
		added_by: uuidRef(true),
	},
	opts("LiveSessionSeat", "lc_enrolments")
);

export class LiveSessionAttendance extends Model {}
LiveSessionAttendance.init(
	{
		id,
		class_id: uuidRef(false),
		participant_key: { type: DataTypes.STRING(64), allowNull: false },
		display_name: { type: DataTypes.STRING(120), allowNull: false },
		status: { type: DataTypes.ENUM("present", "late", "absent", "excused"), defaultValue: "present" },
		source: { type: DataTypes.ENUM("auto", "instructor"), defaultValue: "auto" },
		first_joined_at: DataTypes.DATE(3),
		last_seen_at: DataTypes.DATE(3),
		left_at: DataTypes.DATE(3),
		total_seconds: { type: DataTypes.INTEGER, defaultValue: 0 },
		note: DataTypes.STRING(300),
	},
	opts("LiveSessionAttendance", "lc_attendance")
);

// In-app notifications. dedupe_key is unique: a retried operation never notifies twice.
export class Notification extends Model {}
Notification.init(
	{
		id,
		user_id: uuidRef(false),
		type: { type: DataTypes.STRING(40), allowNull: false },
		title: { type: DataTypes.STRING(200), allowNull: false },
		body: DataTypes.TEXT,
		link: DataTypes.STRING(300),
		ref_id: uuidRef(true),
		dedupe_key: { type: DataTypes.STRING(190), allowNull: false },
		email_status: { type: DataTypes.ENUM("none", "sent", "skipped", "failed"), defaultValue: "none" },
		read_at: DataTypes.DATE,
	},
	opts("Notification", "notifications")
);

// Live-question images (private; served only by an authorised route).
export class LiveQuestionImage extends Model {}
LiveQuestionImage.init(
	{
		id,
		course_id: uuidRef(false),
		class_id: uuidRef(true),
		uploader_id: uuidRef(false),
		mime: { type: DataTypes.STRING(32), allowNull: false },
		size: { type: DataTypes.INTEGER, allowNull: false },
		data: { type: DataTypes.BLOB("medium"), allowNull: false },
	},
	opts("LiveQuestionImage", "live_question_images")
);
