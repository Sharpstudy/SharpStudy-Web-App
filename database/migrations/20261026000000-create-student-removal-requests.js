'use strict';
// Student removal requests: an instructor asks an administrator to remove THEIR OWN instructor link to a learner
// profile (ml_learner_guardians, relation = 'instructor'). Additive only: one new table. Nothing existing is altered
// or dropped, and down() removes only this table.
//
// Safe to run more than once, and safe to re-run after a partial failure:
//   - the table is created only when it does not exist;
//   - every index is checked by name (SHOW INDEX) and added only when missing, so an existing index never makes the
//     migration fail;
//   - before creating anything, the referenced key columns are read from information_schema and the migration stops,
//     having changed nothing, if they are not what the new foreign keys need.
//
// Foreign keys (verified against the live schema: users.id and ml_learners.id are both CHAR(36), utf8mb4 / utf8mb4_bin,
// InnoDB primary keys). Sequelize's UUID type is CHAR(36) BINARY, which in a utf8mb4 table is exactly utf8mb4_bin, so the
// table character set is pinned to utf8mb4 (not left to the database default) and the columns match the parents:
//   instructor_id    -> users.id        ON DELETE CASCADE   requests belong to the instructor account (accounts are
//                                                           anonymized, never row-deleted, so history is not lost in practice)
//   learner_id       -> ml_learners.id  ON DELETE SET NULL  deleting a learner profile (an existing Family action that
//                                                           already cascades through 10 tables) must never be blocked by,
//                                                           or erase the history of, a request; learner_name is a snapshot
//   student_user_id  -> users.id        ON DELETE SET NULL  the linked student account, shown for information only
//   decided_by       -> users.id        ON DELETE SET NULL  keep the decision even if the admin account goes away
//
// One pending request per instructor + learner is enforced by the database: pending_key holds
// "<instructor_id>:<learner_id>" while the request is pending and is set to NULL when it is decided (NULLs do not
// collide in a unique index), so a new request is possible after a rejection or an approval.

const TABLE = "student_removal_requests";
const PARENTS = ["users", "ml_learners"];

// name -> columns. The unique one is the duplicate-pending guard.
const INDEXES = [
	{ name: "uq_removal_pending", fields: ["pending_key"], unique: true },
	{ name: "ix_removal_status", fields: ["status", "created_at"] },
	{ name: "ix_removal_instructor", fields: ["instructor_id", "created_at"] },
	{ name: "ix_removal_learner", fields: ["learner_id"] },
];

// The foreign keys need identical type, length, character set and collation on both sides. Read-only.
async function assertParentKeysMatch(queryInterface) {
	const sequelize = queryInterface.sequelize;
	const rows = await sequelize.query(
		"SELECT TABLE_NAME AS t, COLUMN_TYPE AS ty, CHARACTER_SET_NAME AS cs, COLLATION_NAME AS co FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND COLUMN_NAME = 'id' AND TABLE_NAME IN ('users', 'ml_learners')",
		{ type: sequelize.QueryTypes.SELECT }
	);
	for (const table of PARENTS) {
		const r = rows.find((x) => x.t === table);
		if (!r) throw new Error(`${TABLE}: cannot find ${table}.id, so nothing was created.`);
		if (r.ty !== "char(36)" || r.cs !== "utf8mb4" || r.co !== "utf8mb4_bin") {
			throw new Error(`${TABLE}: ${table}.id is ${r.ty} ${r.cs}/${r.co}, but the new foreign keys need char(36) utf8mb4/utf8mb4_bin. Nothing was created.`);
		}
	}
}

/** @type {import('sequelize-cli').Migration} */
module.exports = {
	async up(queryInterface, Sequelize) {
		const { UUID, STRING, TEXT, DATE, ENUM } = Sequelize;

		if (!(await queryInterface.tableExists(TABLE))) {
			await assertParentKeysMatch(queryInterface);
			await queryInterface.createTable(
				TABLE,
				{
					id: { type: UUID, primaryKey: true, allowNull: false },
					instructor_id: { type: UUID, allowNull: false, onDelete: "CASCADE", references: { model: "users", key: "id" } },
					learner_id: { type: UUID, allowNull: true, onDelete: "SET NULL", references: { model: "ml_learners", key: "id" } },
					learner_name: { type: STRING(40), allowNull: false },
					student_user_id: { type: UUID, allowNull: true, onDelete: "SET NULL", references: { model: "users", key: "id" } },
					relation: { type: STRING(24), allowNull: false, defaultValue: "instructor_link" },
					reason_code: { type: ENUM("registered_incorrectly", "duplicate_profile", "no_longer_belongs", "incorrect_assignment", "other"), allowNull: false },
					comments: { type: TEXT },
					status: { type: ENUM("pending", "approved", "rejected"), allowNull: false, defaultValue: "pending" },
					pending_key: { type: STRING(80), allowNull: true },
					decided_by: { type: UUID, allowNull: true, onDelete: "SET NULL", references: { model: "users", key: "id" } },
					decided_at: { type: DATE(3) },
					decision_note: { type: TEXT },
					created_at: { allowNull: false, type: DATE(3), defaultValue: Sequelize.literal("CURRENT_TIMESTAMP(3)") },
					updated_at: { allowNull: false, type: DATE(3), defaultValue: Sequelize.literal("CURRENT_TIMESTAMP(3)") },
				},
				{ charset: "utf8mb4" }
			);
		}

		// Add only the indexes that are missing (also completes a table left half-finished by an earlier failed run).
		const have = new Set((await queryInterface.showIndex(TABLE)).map((i) => i.name));
		for (const ix of INDEXES) {
			if (!have.has(ix.name)) await queryInterface.addIndex(TABLE, ix.fields, { name: ix.name, ...(ix.unique ? { unique: true } : {}) });
		}
	},

	// Drops only this table. Nothing else references it, so no other table or row is affected.
	async down(queryInterface) {
		await queryInterface.dropTable(TABLE);
	},
};
