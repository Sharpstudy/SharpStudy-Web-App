"use strict";
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn("enrolments", "courseQuizCompleted", {
      type: Sequelize.BOOLEAN,
      allowNull: false,
      onDelete: "CASCADE",
      defaultValue: false
    });
  },
  async down(queryInterface, Sequelize) {
    await queryInterface.removeColumn("enrolments", "courseQuizCompleted");
  },
};
