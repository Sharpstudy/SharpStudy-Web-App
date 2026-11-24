'use strict';
// Keeps the applicant's complete submitted form for every submission, so the answers of earlier attempts (and of earlier
// submissions inside one attempt) are never lost when the application row is edited or a new attempt is started.
//
// Additive only: ONE new nullable column, telecaller_application_events.form_snapshot (JSON). Nothing else is created,
// altered or dropped, no existing row is touched (existing events simply have NULL there and keep working), and no index,
// key or other table is involved.
//
// What goes in it (written by lib/telecallers/service.js, only on an applicant's submit / resubmit event): the form fields
// exactly as submitted, and a reference to the resume versions attached at that moment. It never contains admin notes,
// internal notes, feedback or file bytes. The event already carries the attempt number, so a snapshot is tied to its attempt.
// Events are append-only, so a snapshot is written once with its event and is never updated.
//
// Safe to run more than once: the column is added only when it does not exist. The table is checked first and the
// migration stops, having changed nothing, if it is missing (run 20261027000000 first).
//
// down() removes only this column. That DISCARDS every stored snapshot, so it is only for undoing this change before
// snapshots matter; the rest of the application history is unaffected.

const TABLE = "telecaller_application_events";
const COLUMN = "form_snapshot";

/** @type {import('sequelize-cli').Migration} */
module.exports = {
	async up(queryInterface, Sequelize) {
		if (!(await queryInterface.tableExists(TABLE))) {
			throw new Error(`${TABLE} does not exist (apply 20261027000000-create-telecaller-applications.js first), so nothing was changed.`);
		}
		const columns = await queryInterface.describeTable(TABLE);
		if (!columns[COLUMN]) {
			await queryInterface.addColumn(TABLE, COLUMN, { type: Sequelize.JSON, allowNull: true, after: "internal_note" });
		}
	},

	// Removes only the snapshot column (and so the snapshots in it). Nothing else changes.
	async down(queryInterface) {
		if (!(await queryInterface.tableExists(TABLE))) return;
		const columns = await queryInterface.describeTable(TABLE);
		if (columns[COLUMN]) await queryInterface.removeColumn(TABLE, COLUMN);
	},
};
