'use strict';
/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('answer_options', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.UUIDV4,
        primaryKey: true,
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
      option_text: {
        type: Sequelize.TEXT
      },
      is_correct: {
        type: Sequelize.BOOLEAN
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
    await queryInterface.dropTable('answer_options');
  }
};