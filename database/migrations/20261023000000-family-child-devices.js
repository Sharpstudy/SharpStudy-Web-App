'use strict';
// Family & child devices. Additive and reversible: nothing is dropped or rewritten.
//
//  - ml_learners gets an age band and an optional picture code (hash + its own lockout counters).
//    Existing rows keep NULL and behave exactly as before (PIN login on /study).
//  - fam_pins:            one family PIN per owning account (bcrypt hash + lockout).
//  - fam_pairing_codes:   short-lived, single-use codes. Only an HMAC of the code is stored.
//  - fam_devices:         a child's tablet/phone: pending -> approved -> revoked (or denied/expired).
//  - fam_device_learners: which children a device may sign in as (a shared tablet has several).

/** @type {import('sequelize-cli').Migration} */
module.exports = {
	async up(queryInterface, Sequelize) {
		const { UUID, UUIDV4, STRING, INTEGER, DATE, ENUM, JSON: JSONT } = Sequelize;
		const timestamps = {
			created_at: { allowNull: false, type: DATE, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
			updated_at: { allowNull: false, type: DATE, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
		};
		const userFk = { type: UUID, allowNull: false, onDelete: "CASCADE", references: { model: "users", key: "id" } };

		const cols = await queryInterface.describeTable("ml_learners");
		const add = async (name, def) => {
			if (!cols[name]) await queryInterface.addColumn("ml_learners", name, def);
		};
		await add("age_band", { type: STRING(3), allowNull: true });
		await add("picture_hash", { type: STRING(100), allowNull: true });
		await add("picture_failed_attempts", { type: INTEGER, allowNull: false, defaultValue: 0 });
		await add("picture_locked_until", { type: DATE, allowNull: true });

		await queryInterface.createTable("fam_pins", {
			id: { type: UUID, defaultValue: UUIDV4, primaryKey: true },
			user_id: userFk,
			pin_hash: { type: STRING(100), allowNull: false },
			failed_attempts: { type: INTEGER, allowNull: false, defaultValue: 0 },
			locked_until: { type: DATE },
			...timestamps,
		});
		await queryInterface.addIndex("fam_pins", ["user_id"], { unique: true, name: "uq_fam_pins_user" });

		await queryInterface.createTable("fam_pairing_codes", {
			id: { type: UUID, defaultValue: UUIDV4, primaryKey: true },
			owner_user_id: userFk,
			created_by: { type: UUID, allowNull: false },
			code_hash: { type: STRING(64), allowNull: false },
			learner_ids: { type: JSONT, allowNull: false },
			status: { type: ENUM("open", "claimed", "approved", "denied", "cancelled"), allowNull: false, defaultValue: "open" },
			expires_at: { type: DATE, allowNull: false },
			claimed_at: { type: DATE },
			...timestamps,
		});
		await queryInterface.addIndex("fam_pairing_codes", ["code_hash"], { unique: true, name: "uq_fam_codes_hash" });
		await queryInterface.addIndex("fam_pairing_codes", ["owner_user_id", "status"]);

		await queryInterface.createTable("fam_devices", {
			id: { type: UUID, defaultValue: UUIDV4, primaryKey: true },
			owner_user_id: userFk,
			pairing_code_id: { type: UUID, allowNull: false, onDelete: "CASCADE", references: { model: "fam_pairing_codes", key: "id" } },
			name: { type: STRING(60) },
			label: { type: STRING(80), allowNull: false, defaultValue: "Device" },
			secret_hash: { type: STRING(64), allowNull: false },
			status: { type: ENUM("pending", "approved", "denied", "revoked"), allowNull: false, defaultValue: "pending" },
			pending_until: { type: DATE, allowNull: false },
			approved_at: { type: DATE },
			approved_by: { type: UUID },
			revoked_at: { type: DATE },
			revoked_by: { type: UUID },
			last_seen_at: { type: DATE },
			...timestamps,
		});
		// One device per code: a code can be redeemed exactly once, even under concurrent requests.
		await queryInterface.addIndex("fam_devices", ["pairing_code_id"], { unique: true, name: "uq_fam_devices_code" });
		await queryInterface.addIndex("fam_devices", ["owner_user_id", "status"]);

		await queryInterface.createTable("fam_device_learners", {
			id: { type: UUID, defaultValue: UUIDV4, primaryKey: true },
			device_id: { type: UUID, allowNull: false, onDelete: "CASCADE", references: { model: "fam_devices", key: "id" } },
			learner_id: { type: UUID, allowNull: false, onDelete: "CASCADE", references: { model: "ml_learners", key: "id" } },
			...timestamps,
		});
		await queryInterface.addIndex("fam_device_learners", ["device_id", "learner_id"], { unique: true, name: "uq_fam_device_learner" });
		await queryInterface.addIndex("fam_device_learners", ["learner_id"]);
	},

	// Rolls back ONLY what this migration created (children first).
	async down(queryInterface) {
		for (const t of ["fam_device_learners", "fam_devices", "fam_pairing_codes", "fam_pins"]) await queryInterface.dropTable(t);
		const cols = await queryInterface.describeTable("ml_learners");
		for (const c of ["picture_locked_until", "picture_failed_attempts", "picture_hash", "age_band"]) {
			if (cols[c]) await queryInterface.removeColumn("ml_learners", c);
		}
	},
};
