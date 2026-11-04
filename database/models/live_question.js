// Live-question models (tables created by
// migrations/20261014000000-create-live-questions.js). Used through
// lib/live-questions/repo.js.
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

export class LiveQuestion extends Model {}
LiveQuestion.init(
	{
		id,
		course_id: { type: DataTypes.UUID, allowNull: false },
		// The scheduled live session (lc_classes.id) this question belongs to; NULL for course-level classes.
		class_id: { type: DataTypes.CHAR(36).BINARY, allowNull: true },
		instructor_id: { type: DataTypes.UUID, allowNull: false },
		image_id: { type: DataTypes.CHAR(36).BINARY, allowNull: true },
		seq: { type: DataTypes.INTEGER, allowNull: false },
		question_type: { type: DataTypes.STRING(20), defaultValue: "single" },
		question_text: { type: DataTypes.TEXT, allowNull: false },
		options: {
			type: DataTypes.JSON,
			get() {
				const v = this.getDataValue("options");
				if (typeof v === "string") {
					try {
						return JSON.parse(v);
					} catch (e) {
						return [];
					}
				}
				return v;
			},
		},
		correct_option_id: { type: DataTypes.STRING(16), allowNull: false },
		explanation: DataTypes.TEXT,
		source_question_id: DataTypes.UUID,
		status: { type: DataTypes.ENUM("draft", "open", "closed", "revealed"), defaultValue: "draft" },
		duration_sec: DataTypes.INTEGER,
		allow_change: { type: DataTypes.BOOLEAN, defaultValue: false },
		results_published: { type: DataTypes.BOOLEAN, defaultValue: false },
		deadline_at: DataTypes.DATE,
		opened_at: DataTypes.DATE,
		closed_at: DataTypes.DATE,
		revealed_at: DataTypes.DATE,
	},
	opts("LiveQuestion", "live_questions")
);

export class LiveQuestionResponse extends Model {}
LiveQuestionResponse.init(
	{
		id,
		live_question_id: { type: DataTypes.UUID, allowNull: false },
		user_id: { type: DataTypes.UUID, allowNull: false },
		option_id: { type: DataTypes.STRING(16), allowNull: false },
		is_correct: { type: DataTypes.BOOLEAN, allowNull: false },
		submitted_at: { type: DataTypes.DATE, allowNull: false },
	},
	opts("LiveQuestionResponse", "live_question_responses")
);
