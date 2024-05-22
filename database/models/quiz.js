import { Model, DataTypes } from "sequelize";
import connection from "../connection";

const initQuiz = (sequelize, Types) => {
  class Quiz extends Model {
    /**
     * Helper method for defining associations.
     * This method is not a part of Sequelize lifecycle.
     * The `models/index` file will call this method automatically.
     */
    static associate(models) {
      // define association here
    }
  }
  Quiz.init(
    {
      id: {
        type: Types.UUID,
        defaultValue: Types.UUIDV4,
        primaryKey: true,
      },
      title: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      description: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      slug: {
        type: DataTypes.STRING,
        unique: true,
      },
      courseId: {
        type: DataTypes.UUID,
        allowNull: false,
        onDelete: "CASCADE",
        references: {
          model: "courses",
          key: "id",
          as: "courseId",
        },
      },
      userId: {
        type: DataTypes.UUID,
        allowNull: false,
        onDelete: "CASCADE",
        references: {
          model: "users",
          key: "id",
          as: "userId",
        },
      },
    },
    {
      sequelize,
      modelName: "Quiz",
      tableName: "quizzes",
      createdAt: "created_at",
      updatedAt: "updated_at",
      validate: {
        // Validate all fields
        validateFields() {
          if (!this.title) {
            throw new Error("Title field is required");
          }
          if (!this.description) {
            throw new Error("Description field required");
          }
        },

      }
    }
  );
  return Quiz;
};
export default initQuiz(connection, DataTypes);
