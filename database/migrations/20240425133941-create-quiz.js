'use strict';
/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('quizzes', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.UUIDV4,
        primaryKey: true,
      },
      title: {
        type: Sequelize.STRING
      },
      description: {
        type: Sequelize.STRING
      },
      slug: {
        type: Sequelize.STRING,
        allowNull: false,
        unique: true,
      },
      courseId: {
        type: Sequelize.UUID,
        allowNull: false,
        onDelete: "CASCADE",
        references: {
          model: "courses",
          key: "id",
          as: "courseId",
        },
      },
      userId: {
        type: Sequelize.UUID,
        allowNull: false,
        onDelete: "CASCADE",
        references: {
          model: "users",
          key: "id",
          as: "userId",
        },
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
    await queryInterface.dropTable('quizzes');
  }
};