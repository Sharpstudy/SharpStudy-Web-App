'use strict';
// MySQL counterpart of database/migrations-pg/20261123000006-pg-meeting-requests-free-demo.js (same columns, same meaning).
// Free Demo Class requests live in the existing `meeting_requests` table: seven new columns (nullable, `kind` defaults to 'meeting') and
// `email`, `requested_date`, `requested_time`, `requested_at` become nullable. Ordinary meeting requests are still required to have them
// (enforced in lib/meetings/service.js; the PostgreSQL migration also enforces it with a CHECK constraint).
// down() refuses to run while a free-demo row exists.

/** @type {import('sequelize-cli').Migration} */
module.exports = {
	async up(queryInterface, Sequelize) {
		const { STRING, DATE, DATEONLY, CHAR } = Sequelize;
		const t = "meeting_requests";
		const cols = await queryInterface.describeTable(t);
		const add = async (name, def) => {
			if (!cols[name]) await queryInterface.addColumn(t, name, def);
		};
		await add("kind", { type: STRING(16), allowNull: false, defaultValue: "meeting" });
		await add("child_name", { type: STRING(120) });
		await add("child_grade", { type: STRING(40) });
		await add("program", { type: STRING(40) });
		await add("source", { type: STRING(40) });
		await add("source_page", { type: STRING(160) });
		await add("class_mode", { type: STRING(16) });
		await queryInterface.changeColumn(t, "email", { type: STRING(200), allowNull: true });
		await queryInterface.changeColumn(t, "requested_date", { type: DATEONLY, allowNull: true });
		await queryInterface.changeColumn(t, "requested_time", { type: CHAR(5), allowNull: true });
		await queryInterface.changeColumn(t, "requested_at", { type: DATE, allowNull: true });
		await queryInterface.addIndex(t, ["kind", "created_at"], { name: "idx_meeting_requests_kind_created" }).catch(() => {});
		await queryInterface.addIndex(t, ["program"], { name: "idx_meeting_requests_program" }).catch(() => {});
		await queryInterface.addIndex(t, ["source"], { name: "idx_meeting_requests_source" }).catch(() => {});
	},

	async down(queryInterface, Sequelize) {
		const { STRING, DATE, DATEONLY, CHAR } = Sequelize;
		const t = "meeting_requests";
		const [[c]] = await queryInterface.sequelize.query("SELECT COUNT(*) AS n FROM meeting_requests WHERE kind = 'free_demo'");
		if (Number(c.n) > 0) throw new Error(`${c.n} free-demo request(s) exist; rolling back would delete their data. Nothing was changed.`);
		for (const name of ["idx_meeting_requests_kind_created", "idx_meeting_requests_program", "idx_meeting_requests_source"]) await queryInterface.removeIndex(t, name).catch(() => {});
		await queryInterface.changeColumn(t, "email", { type: STRING(200), allowNull: false });
		await queryInterface.changeColumn(t, "requested_date", { type: DATEONLY, allowNull: false });
		await queryInterface.changeColumn(t, "requested_time", { type: CHAR(5), allowNull: false });
		await queryInterface.changeColumn(t, "requested_at", { type: DATE, allowNull: false });
		for (const name of ["class_mode", "source_page", "source", "program", "child_grade", "child_name", "kind"]) await queryInterface.removeColumn(t, name);
	},
};
