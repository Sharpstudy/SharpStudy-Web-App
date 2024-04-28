import { Model, DataTypes } from "sequelize";
import connection from "../connection";

const initUser_Response = (sequelize, Types) => {
  class User_Response extends Model {
    /**
     * Helper method for defining associations.
     * This method is not a part of Sequelize lifecycle.
     * The `models/index` file will call this method automatically.
     */
    static associate(models) {
      // define association here
    }
  }
  User_Response.init(
    {
      id: {
        type: Types.UUID,
        defaultValue: Types.UUIDV4,
        primaryKey: true,
      },
      is_answered_correctly: DataTypes.BOOLEAN,
      enrolmentId: {
        type: DataTypes.UUID,
        allowNull: false,
        onDelete: "CASCADE",
        references: {
          model: "enrolments",
          key: "id",
          as: "enrolmentId",
        },
      },
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
      modelName: "User_Response",
      tableName: "user_responses",
      createdAt: "created_at",
      updatedAt: "updated_at",
    }
  );
  return User_Response;
};

export default initUser_Response(connection, DataTypes);
