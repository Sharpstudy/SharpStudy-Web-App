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
      title: DataTypes.STRING,
      description: DataTypes.STRING,
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
    }
  );
  return Question;
};
export default initQuestion(connection, DataTypes);
