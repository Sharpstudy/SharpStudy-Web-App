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
      title: DataTypes.STRING,
      description: DataTypes.STRING,
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
    },
    {
      sequelize,
      modelName: "Quiz",
      tableName: "quizzes",
      createdAt: "created_at",
      updatedAt: "updated_at",
    }
  );
  return Quiz;
};
export default initQuiz(connection, DataTypes);
