import { Model, DataTypes } from "sequelize";
import connection from "../connection";

const initAnswer_Options = (sequelize, Types) => {
  class Answer_Options extends Model {
    /**
     * Helper method for defining associations.
     * This method is not a part of Sequelize lifecycle.
     * The `models/index` file will call this method automatically.
     */
    static associate(models) {
      // define association here
    }
  }
  Answer_Options.init(
    {
      id: {
        type: Types.UUID,
        defaultValue: Types.UUIDV4,
        primaryKey: true,
      },
      option_text: DataTypes.TEXT,
      is_correct: DataTypes.BOOLEAN,
      questionId: {
        type: DataTypes.UUID,
        allowNull: false,
        onDelete: "CASCADE",
        references: {
          model: "questions",
          key: "id",
          as: "questionId",
        },
      },
    },
    {
      sequelize,
      modelName: "Answer_Option",
      tableName: "answer_options",
      createdAt: "created_at",
      updatedAt: "updated_at",
    }
  );
  return Answer_Options;
};
export default initAnswer_Options(connection, DataTypes);
