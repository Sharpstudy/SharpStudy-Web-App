"use strict";
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn("enrolments", "currentQuestionId", {
      type: Sequelize.UUID,
      allowNull: true,
      onDelete: "CASCADE",
      defaultValue: null
    });
  },
  async down(queryInterface, Sequelize) {
    await queryInterface.removeColumn("enrolments", "currentQuestionId");
  },
};
