'use strict';
// Shared telecaller follow-up for the existing "Talk to our team" meeting requests.
// Additive only: three new tables. meeting_requests and meeting_request_events are NOT altered: the customer's request
// workflow (pending / approved / rejected / reschedule_requested / cancelled) is untouched, and the telecaller follow-up
// state lives beside it, joined by the meeting request id. down() removes only these three tables.
//
//   meeting_followups        ONE row per meeting, created lazily the first time a telecaller acts on it. No row means the
//                            meeting has had no follow-up yet ("not contacted"; a pending one is a "new request").
//                            Holds the follow-up status, the current owner ("currently handling"), the ownership time,
//                            last contact, next follow-up and a `version` for compare-and-set ownership changes.
//   meeting_call_logs        append-only call history shared by every telecaller. There is no update or delete path.
//   meeting_followup_events  append-only audit of ownership changes (take / transfer / admin assign / admin clear),
//                            status changes and explicit completion, each with who, when and why.
//
// Foreign keys (users.id and meeting_requests.id are both CHAR(36) utf8mb4 / utf8mb4_bin InnoDB keys; the tables are
// pinned to utf8mb4 as in 20261026000000-create-student-removal-requests.js):
//   meeting_followups.meeting_request_id (primary key) -> meeting_requests.id CASCADE
//   meeting_followups.owner_user_id / completed_by      -> users.id SET NULL
//   meeting_call_logs / meeting_followup_events .meeting_request_id -> meeting_requests.id RESTRICT: a meeting that has
//        call or audit history can never be deleted out from under that history (no code path deletes meetings today).
//   every user reference in the logs is SET NULL, and the person's name is stored as a snapshot beside it, so the history
//   stays readable even if an account goes away.
//
// Safe to run more than once and after a partial failure (same approach as the applications migration): tables are
// created only when missing, indexes only when missing, and both parent keys are verified first (nothing created if not).

const PARENTS = ["users", "meeting_requests"];

const timestamps = (S) => ({
	created_at: { allowNull: false, type: S.DATE(3), defaultValue: S.literal("CURRENT_TIMESTAMP(3)") },
	updated_at: { allowNull: false, type: S.DATE(3), defaultValue: S.literal("CURRENT_TIMESTAMP(3)") },
});
const created = (S) => ({ created_at: { allowNull: false, type: S.DATE(3), defaultValue: S.literal("CURRENT_TIMESTAMP(3)") } });

const FOLLOW_UP_STATUSES = ["not_contacted", "contacted", "follow_up_required", "meeting_confirmed", "not_interested", "unable_to_reach", "completed"];

const tables = (S) => {
	const { UUID, STRING, TEXT, DATE, ENUM, BOOLEAN, INTEGER } = S;
	const fkUser = (onDelete = "SET NULL") => ({ type: UUID, allowNull: true, onDelete, references: { model: "users", key: "id" } });
	const fkMeeting = (onDelete) => ({ type: UUID, allowNull: false, onDelete, references: { model: "meeting_requests", key: "id" } });
	return [
		{
			name: "meeting_followups",
			columns: {
				meeting_request_id: { ...fkMeeting("CASCADE"), primaryKey: true },
				follow_up_status: { type: ENUM(...FOLLOW_UP_STATUSES), allowNull: false, defaultValue: "not_contacted" },
				owner_user_id: fkUser(),
				owned_at: { type: DATE(3) },
				last_contacted_at: { type: DATE(3) },
				next_follow_up_at: { type: DATE(3) },
				// "completed" is only ever set explicitly, after the outcome is verified; never inferred from the clock.
				completed_at: { type: DATE(3) },
				completed_by: fkUser(),
				completion_note: { type: STRING(500) },
				version: { type: INTEGER, allowNull: false, defaultValue: 0 }, // compare-and-set for ownership / status changes
				...timestamps(S),
			},
			indexes: [
				{ name: "ix_followup_owner", fields: ["owner_user_id", "next_follow_up_at"] },
				{ name: "ix_followup_status", fields: ["follow_up_status"] },
				{ name: "ix_followup_next", fields: ["next_follow_up_at"] },
			],
		},
		{
			name: "meeting_call_logs",
			columns: {
				id: { type: UUID, primaryKey: true, allowNull: false },
				meeting_request_id: fkMeeting("RESTRICT"),
				telecaller_user_id: fkUser(),
				telecaller_name: { type: STRING(120), allowNull: false }, // snapshot
				called_at: { type: DATE(3), allowNull: false }, // when the call happened (entered by the telecaller)
				answered: { type: BOOLEAN, allowNull: false },
				outcome: { type: ENUM("spoke_to_customer", "no_answer", "busy", "voicemail_left", "wrong_number", "call_back_requested", "other"), allowNull: false },
				interest: { type: ENUM("high", "medium", "low", "none") },
				follow_up_status_after: { type: ENUM(...FOLLOW_UP_STATUSES) }, // the follow-up status this call set, if it changed it
				notes: { type: TEXT, allowNull: false },
				next_follow_up_at: { type: DATE(3) },
				confirmation_details: { type: TEXT }, // meeting confirmation details recorded by the telecaller (does not change the meeting itself)
				...created(S), // append-only: no updated_at
			},
			indexes: [
				{ name: "ix_calllog_meeting", fields: ["meeting_request_id", "called_at"] },
				{ name: "ix_calllog_caller", fields: ["telecaller_user_id", "called_at"] },
			],
		},
		{
			name: "meeting_followup_events",
			columns: {
				id: { type: UUID, primaryKey: true, allowNull: false },
				meeting_request_id: fkMeeting("RESTRICT"),
				event_type: { type: ENUM("take", "transfer", "admin_assign", "admin_clear", "status_change", "completed"), allowNull: false },
				actor_user_id: fkUser(),
				actor_name: { type: STRING(120), allowNull: false },
				actor_role: { type: ENUM("telecaller", "admin"), allowNull: false },
				from_user_id: fkUser(),
				from_name: { type: STRING(120) },
				to_user_id: fkUser(),
				to_name: { type: STRING(120) },
				from_status: { type: STRING(24) },
				to_status: { type: STRING(24) },
				reason: { type: STRING(500) }, // required by the service for every ownership change
				...created(S), // append-only: no updated_at
			},
			indexes: [
				{ name: "ix_fuevent_meeting", fields: ["meeting_request_id", "created_at"] },
				{ name: "ix_fuevent_actor", fields: ["actor_user_id", "created_at"] },
			],
		},
	];
};

// Read-only: both parent keys must match what the new foreign keys need.
async function assertParentKeysMatch(queryInterface) {
	const sequelize = queryInterface.sequelize;
	const rows = await sequelize.query(
		`SELECT TABLE_NAME AS t, COLUMN_TYPE AS ty, CHARACTER_SET_NAME AS cs, COLLATION_NAME AS co FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND COLUMN_NAME = 'id' AND TABLE_NAME IN (${PARENTS.map((p) => `'${p}'`).join(", ")})`,
		{ type: sequelize.QueryTypes.SELECT }
	);
	for (const table of PARENTS) {
		const r = rows.find((x) => x.t === table);
		if (!r) throw new Error(`meeting follow-up tables: cannot find ${table}.id, so nothing was created.`);
		if (r.ty !== "char(36)" || r.cs !== "utf8mb4" || r.co !== "utf8mb4_bin") {
			throw new Error(`meeting follow-up tables: ${table}.id is ${r.ty} ${r.cs}/${r.co}, but the new foreign keys need char(36) utf8mb4/utf8mb4_bin. Nothing was created.`);
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
			const have = new Set((await queryInterface.showIndex(t.name)).map((i) => i.name));
			for (const ix of t.indexes) {
				if (!have.has(ix.name)) await queryInterface.addIndex(t.name, ix.fields, { name: ix.name, ...(ix.unique ? { unique: true } : {}) });
			}
		}
	},

	// Drops only these three tables, children first. meeting_requests and everything else stay exactly as they are.
	async down(queryInterface) {
		for (const name of ["meeting_followup_events", "meeting_call_logs", "meeting_followups"]) {
			await queryInterface.dropTable(name);
		}
	},
};
