'use strict';
/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('questions', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.UUIDV4,
        primaryKey: true,
      },
      question_text: {
        type: Sequelize.TEXT
      },
      quizId: {
        type: Sequelize.UUID,
        allowNull: false,
        onDelete: "CASCADE",
        references: {
          model: "quizzes",
          key: "id",
          as: "quizId",
        },
      },
      createdAt: {
        allowNull: false,
        type: Sequelize.DATE
      },
      updatedAt: {
        allowNull: false,
        type: Sequelize.DATE
      }
    });
  },
  async down(queryInterface, Sequelize) {
    await queryInterface.dropTable('questions');
  }
};