// Instructor requests to remove their own instructor link to a learner profile (table student_removal_requests,
// migration 20261026000000). Used through lib/removals/repo.js.
import { Model, DataTypes } from "sequelize";
import connection from "../connection";

export class StudentRemovalRequest extends Model {}
StudentRemovalRequest.init(
	{
		id: { type: DataTypes.UUID, primaryKey: true },
		instructor_id: { type: DataTypes.UUID, allowNull: false },
		learner_id: DataTypes.UUID,
		learner_name: { type: DataTypes.STRING(40), allowNull: false },
		student_user_id: DataTypes.UUID,
		relation: { type: DataTypes.STRING(24), allowNull: false, defaultValue: "instructor_link" },
		reason_code: { type: DataTypes.ENUM("registered_incorrectly", "duplicate_profile", "no_longer_belongs", "incorrect_assignment", "other"), allowNull: false },
		comments: DataTypes.TEXT,
		status: { type: DataTypes.ENUM("pending", "approved", "rejected"), allowNull: false, defaultValue: "pending" },
		pending_key: DataTypes.STRING(80),
		decided_by: DataTypes.UUID,
		decided_at: DataTypes.DATE(3),
		decision_note: DataTypes.TEXT,
	},
	{ sequelize: connection, modelName: "StudentRemovalRequest", tableName: "student_removal_requests", createdAt: "created_at", updatedAt: "updated_at" }
);
