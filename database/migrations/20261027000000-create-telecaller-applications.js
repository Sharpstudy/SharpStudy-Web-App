'use strict';
// Telecaller applications, their history, private resumes and approved-telecaller profiles.
// Additive only: four new tables. Nothing existing is altered or dropped (users.role is NOT changed: an approved
// telecaller is a user with an ACTIVE row in telecaller_profiles; applicants, pending and rejected users stay students).
// down() removes only these four tables.
//
// Safe to run more than once and safe to re-run after a partial failure (same approach as
// 20261026000000-create-student-removal-requests.js):
//   - each table is created only when it does not exist;
//   - every index is checked by name (SHOW INDEX) and added only when missing;
//   - before creating anything, users.id is read from information_schema and the migration stops, having changed
//     nothing, if it is not what the new foreign keys need.
//
// Foreign keys (users.id is CHAR(36) utf8mb4 / utf8mb4_bin, InnoDB). Sequelize's UUID type is CHAR(36) BINARY, which in a
// utf8mb4 table is exactly utf8mb4_bin, so the table character set is pinned to utf8mb4:
//   telecaller_applications.user_id            -> users.id   CASCADE   the application belongs to the account
//   telecaller_applications.decided_by         -> users.id   SET NULL  keep the decision if the admin account goes away
//   telecaller_application_events.application_id -> telecaller_applications.id CASCADE (history lives with its application)
//   telecaller_application_events.actor_user_id  -> users.id SET NULL
//   telecaller_resumes.application_id          -> telecaller_applications.id CASCADE (many resumes per application)
//   telecaller_profiles.user_id (primary key)  -> users.id   CASCADE
//   telecaller_profiles.application_id/approved_by/status_changed_by -> SET NULL
//
// One application per user is enforced by the database (unique user_id); re-applying after a rejection reuses the row and
// increments `attempt`, with every change kept in telecaller_application_events (the same model as instructor applications).
// History is never overwritten. Every event carries the `attempt` it belongs to, and every resume is stored as its own
// immutable version tied to an attempt: a resubmission or a new attempt ADDS a row, it never replaces or deletes an older
// resume. The resume shown for an attempt is its most recent upload. Resume bytes live in telecaller_resumes.data
// (MEDIUMBLOB, validated to <= 2 MB by the service) and are never joined into list queries; they are only read by the
// admin-only download API. There is no application-level update or delete for events or resumes, and neither table has
// an updated_at column.

const PARENTS = ["users"];

const timestamps = (S) => ({
	created_at: { allowNull: false, type: S.DATE(3), defaultValue: S.literal("CURRENT_TIMESTAMP(3)") },
	updated_at: { allowNull: false, type: S.DATE(3), defaultValue: S.literal("CURRENT_TIMESTAMP(3)") },
});
const created = (S) => ({ created_at: { allowNull: false, type: S.DATE(3), defaultValue: S.literal("CURRENT_TIMESTAMP(3)") } });

const STATUSES = ["draft", "pending", "more_info_requested", "approved", "rejected"];

// In creation order (parents first). down() drops them in reverse.
const tables = (S) => {
	const { UUID, STRING, TEXT, DATE, ENUM, BOOLEAN, INTEGER, CHAR, BLOB } = S;
	const fkUser = (onDelete, allowNull = true) => ({ type: UUID, allowNull, onDelete, references: { model: "users", key: "id" } });
	const fkApp = { type: UUID, allowNull: false, onDelete: "CASCADE", references: { model: "telecaller_applications", key: "id" } };
	return [
		{
			name: "telecaller_applications",
			columns: {
				id: { type: UUID, primaryKey: true, allowNull: false },
				user_id: fkUser("CASCADE", false),
				status: { type: ENUM(...STATUSES), allowNull: false, defaultValue: "draft" },
				attempt: { type: INTEGER, allowNull: false, defaultValue: 1 },
				full_name: { type: STRING(120) },
				phone: { type: STRING(40) },
				city: { type: STRING(80) },
				state: { type: STRING(80) },
				qualification: { type: ENUM("high_school", "diploma", "bachelor", "master", "doctorate", "other") },
				has_telecalling_experience: { type: BOOLEAN },
				experience_years: { type: INTEGER },
				previous_company: { type: STRING(160) },
				languages: { type: STRING(300) },
				employment_preference: { type: ENUM("full_time", "part_time") },
				additional_info: { type: TEXT },
				confirmed_adult: { type: BOOLEAN, allowNull: false, defaultValue: false }, // applicant states they are 18 or older
				consented_privacy: { type: BOOLEAN, allowNull: false, defaultValue: false },
				consented_at: { type: DATE(3) },
				feedback: { type: TEXT }, // latest message to the applicant (shown to them)
				admin_notes: { type: TEXT }, // private, never returned to the applicant
				submitted_at: { type: DATE(3) },
				decided_at: { type: DATE(3) },
				decided_by: fkUser("SET NULL"),
				version: { type: INTEGER, allowNull: false, defaultValue: 0 }, // optimistic concurrency for admin decisions
				...timestamps(S),
			},
			indexes: [
				{ name: "uq_tcapp_user", fields: ["user_id"], unique: true },
				{ name: "ix_tcapp_status", fields: ["status", "submitted_at"] },
			],
		},
		{
			name: "telecaller_application_events",
			columns: {
				id: { type: UUID, primaryKey: true, allowNull: false },
				application_id: fkApp,
				attempt: { type: INTEGER, allowNull: false, defaultValue: 1 }, // the application attempt this event belongs to
				from_status: { type: STRING(24) },
				to_status: { type: STRING(24), allowNull: false },
				actor: { type: ENUM("applicant", "admin", "system"), allowNull: false },
				actor_user_id: fkUser("SET NULL"),
				feedback: { type: TEXT }, // shown to the applicant
				internal_note: { type: TEXT }, // admins only
				email_status: { type: ENUM("none", "sent", "skipped", "failed"), allowNull: false, defaultValue: "none" },
				...created(S), // append-only: no updated_at
			},
			indexes: [{ name: "ix_tcevent_app", fields: ["application_id", "attempt", "created_at"] }],
		},
		{
			name: "telecaller_resumes",
			columns: {
				id: { type: UUID, primaryKey: true, allowNull: false },
				application_id: fkApp,
				attempt: { type: INTEGER, allowNull: false }, // the application attempt this resume was submitted for
				original_filename: { type: STRING(200), allowNull: false },
				mime_type: { type: STRING(100), allowNull: false },
				size_bytes: { type: INTEGER, allowNull: false },
				sha256: { type: CHAR(64), allowNull: false },
				data: { type: BLOB("medium"), allowNull: false },
				uploaded_at: { allowNull: false, type: DATE(3), defaultValue: S.literal("CURRENT_TIMESTAMP(3)") }, // immutable: no updated_at
			},
			indexes: [
				// The same file is not stored twice for one attempt (a repeated upload of identical bytes is a no-op).
				{ name: "uq_tcresume_version", fields: ["application_id", "attempt", "sha256"], unique: true },
				// The resume for an attempt is its latest upload; this index serves that lookup and the per-attempt list.
				{ name: "ix_tcresume_attempt", fields: ["application_id", "attempt", "uploaded_at"] },
			],
		},
		{
			name: "telecaller_profiles",
			columns: {
				user_id: { type: UUID, primaryKey: true, allowNull: false, onDelete: "CASCADE", references: { model: "users", key: "id" } },
				application_id: { type: UUID, allowNull: true, onDelete: "SET NULL", references: { model: "telecaller_applications", key: "id" } },
				status: { type: ENUM("active", "inactive"), allowNull: false, defaultValue: "active" },
				approved_at: { allowNull: false, type: DATE(3), defaultValue: S.literal("CURRENT_TIMESTAMP(3)") },
				approved_by: fkUser("SET NULL"),
				status_changed_at: { type: DATE(3) },
				status_changed_by: fkUser("SET NULL"),
				status_reason: { type: STRING(300) },
				version: { type: INTEGER, allowNull: false, defaultValue: 0 },
				...timestamps(S),
			},
			indexes: [{ name: "ix_tcprofile_status", fields: ["status"] }],
		},
	];
};

// The foreign keys need identical type, length, character set and collation on both sides. Read-only.
async function assertParentKeysMatch(queryInterface) {
	const sequelize = queryInterface.sequelize;
	const rows = await sequelize.query(
		`SELECT TABLE_NAME AS t, COLUMN_TYPE AS ty, CHARACTER_SET_NAME AS cs, COLLATION_NAME AS co FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND COLUMN_NAME = 'id' AND TABLE_NAME IN (${PARENTS.map((p) => `'${p}'`).join(", ")})`,
		{ type: sequelize.QueryTypes.SELECT }
	);
	for (const table of PARENTS) {
		const r = rows.find((x) => x.t === table);
		if (!r) throw new Error(`telecaller tables: cannot find ${table}.id, so nothing was created.`);
		if (r.ty !== "char(36)" || r.cs !== "utf8mb4" || r.co !== "utf8mb4_bin") {
			throw new Error(`telecaller tables: ${table}.id is ${r.ty} ${r.cs}/${r.co}, but the new foreign keys need char(36) utf8mb4/utf8mb4_bin. Nothing was created.`);
		}
	}
}

/** @type {import('sequelize-cli').Migration} */
module.exports = {
	async up(queryInterface, Sequelize) {
		const specs = tables(Sequelize);
		const missing = [];
		for (const t of specs) if (!(await queryInterface.tableExists(t.name))) missing.push(t.name);
		if (missing.length) await assertParentKeysMatch(queryInterface);

		for (const t of specs) {
			if (missing.includes(t.name)) await queryInterface.createTable(t.name, t.columns, { charset: "utf8mb4" });
			// Add only the indexes that are missing (also completes a table left half-finished by an earlier failed run).
			const have = new Set((await queryInterface.showIndex(t.name)).map((i) => i.name));
			for (const ix of t.indexes) {
				if (!have.has(ix.name)) await queryInterface.addIndex(t.name, ix.fields, { name: ix.name, ...(ix.unique ? { unique: true } : {}) });
			}
		}
	},

	// Drops only these four tables, children first. No other table references them.
	async down(queryInterface) {
		for (const name of ["telecaller_resumes", "telecaller_profiles", "telecaller_application_events", "telecaller_applications"]) {
			await queryInterface.dropTable(name);
		}
	},
};
