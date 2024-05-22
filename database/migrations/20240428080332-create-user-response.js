'use strict';
/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('user_responses', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.UUIDV4,
        primaryKey: true,
      },
      is_answered_correctly: {
        type: Sequelize.BOOLEAN
      },
      enrolmentId: {
        type: Sequelize.UUID,
        allowNull: false,
        onDelete: "CASCADE",
        references: {
          model: "enrolments",
          key: "id",
          as: "enrolmentId",
        }
      },
      questionId: {
        type: Sequelize.UUID,
        allowNull: false,
        onDelete: "CASCADE",
        references: {
          model: "questions",
          key: "id",
          as: "questionId",
        }
      },
      created_at: {
        allowNull: false,
        type: Sequelize.DATE,
        defaultValue: Sequelize.literal("CURRENT_TIMESTAMP"),
      },
      updated_at: {
        allowNull: false,
        type: Sequelize.DATE,
        defaultValue: Sequelize.literal("CURRENT_TIMESTAMP"),
      },
    });
  },
  async down(queryInterface, Sequelize) {
    await queryInterface.dropTable('user_responses');
  }
};