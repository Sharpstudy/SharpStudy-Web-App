import { Model, DataTypes } from "sequelize";
import connection from "../connection";

const initQuestion = (sequelize, Types) => {
  class Question extends Model {
    /**
     * Helper method for defining associations.
     * This method is not a part of Sequelize lifecycle.
     * The `models/index` file will call this method automatically.
     */
    static associate(models) {
      // define association here
    }
  }
  Question.init(
    {
      id: {
        type: Types.UUID,
        defaultValue: Types.UUIDV4,
        primaryKey: true,
      },
      question_text: {
        type: DataTypes.TEXT,
        allowNull: false,
      },
      quizId: {
        type: DataTypes.UUID,
        allowNull: false,
        onDelete: "CASCADE",
        references: {
          model: "quizzes",
          key: "id",
          as: "quizId",
        },
      },
    },
    {
      sequelize,
      modelName: "Question",
      tableName: "questions",
      createdAt: "created_at",
      updatedAt: "updated_at",
      validate: {
        // Validate all fields
        validateFields() {
          if (!this.question_text) {
            throw new Error("Question text is required");
          }
          if (!this.quizId) {
            throw new Error("Quiz ID is required");
          }
        },

      }
    }
  );
  return Question;
};
export default initQuestion(connection, DataTypes);
