// The telecaller migrations (applications; shared meeting follow-ups). A recording stand-in for the query interface is
// used, so no database is touched and nothing is migrated by running these.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");
// Source with comments removed, so the checks look at what the migration does and not at what its comments say.
const code = (p) => read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/.*$/gm, "$1");
const A = "../../database/migrations/20261027000000-create-telecaller-applications.js";
const B = "../../database/migrations/20261028000000-create-meeting-followups.js";
const A_SRC = "database/migrations/20261027000000-create-telecaller-applications.js";
const B_SRC = "database/migrations/20261028000000-create-meeting-followups.js";

const KEY = (t) => ({ t, ty: "char(36)", cs: "utf8mb4", co: "utf8mb4_bin" });
const A_TABLES = ["telecaller_applications", "telecaller_application_events", "telecaller_resumes", "telecaller_profiles"];
const B_TABLES = ["meeting_followups", "meeting_call_logs", "meeting_followup_events"];
const A_INDEXES = { telecaller_applications: ["uq_tcapp_user", "ix_tcapp_status"], telecaller_application_events: ["ix_tcevent_app"], telecaller_resumes: ["uq_tcresume_version", "ix_tcresume_attempt"], telecaller_profiles: ["ix_tcprofile_status"] };
const B_INDEXES = { meeting_followups: ["ix_followup_owner", "ix_followup_status", "ix_followup_next"], meeting_call_logs: ["ix_calllog_meeting", "ix_calllog_caller"], meeting_followup_events: ["ix_fuevent_meeting", "ix_fuevent_actor"] };

function fakeInterface({ existing = [], indexes = {}, parents } = {}) {
	const Sequelize = require("sequelize");
	const calls = { created: [], options: [], indexes: [], dropped: [], selects: [] };
	const qi = {
		sequelize: { QueryTypes: { SELECT: "SELECT" }, query: async (sql) => (calls.selects.push(sql), parents) },
		tableExists: async (n) => existing.includes(n),
		showIndex: async (n) => (indexes[n] || []).map((name) => ({ name })),
		createTable: async (name, cols, options) => (calls.created.push({ name, cols }), calls.options.push(options)),
		addIndex: async (table, cols, opts) => calls.indexes.push({ table, cols, ...opts }),
		dropTable: async (name) => calls.dropped.push(name),
	};
	return { Sequelize, qi, calls };
}
const fk = (c) => ({ table: c.references.model, key: c.references.key, onDelete: c.onDelete });
const byName = (calls) => Object.fromEntries(calls.created.map((t) => [t.name, t.cols]));

test("A creates only the four telecaller tables, parents first, pinned to utf8mb4", async () => {
	const { Sequelize, qi, calls } = fakeInterface({ parents: [KEY("users")] });
	await require(A).up(qi, Sequelize);
	assert.deepEqual(calls.created.map((t) => t.name), A_TABLES);
	assert.ok(calls.options.every((o) => o.charset === "utf8mb4"));
	assert.equal(calls.dropped.length, 0);
});

test("B creates only the three follow-up tables and never alters meeting_requests or users", async () => {
	const { Sequelize, qi, calls } = fakeInterface({ parents: [KEY("users"), KEY("meeting_requests")] });
	await require(B).up(qi, Sequelize);
	assert.deepEqual(calls.created.map((t) => t.name), B_TABLES);
	assert.ok(calls.indexes.every((i) => B_TABLES.includes(i.table)));
	for (const f of [A_SRC, B_SRC]) {
		assert.doesNotMatch(code(f), /addColumn|changeColumn|removeColumn|renameTable|renameColumn|removeIndex|bulkDelete|bulkInsert|truncate|DELETE FROM|UPDATE /i, f);
	}
});

test("users.role is not touched: telecaller access is a profile row, not a new role", () => {
	for (const f of [A_SRC, B_SRC]) assert.doesNotMatch(read(f), /\brole\b\s*:|"role"|"student"/, f);
});

test("A: one application per user; statuses and the 18+ / privacy confirmations", async () => {
	const { Sequelize, qi, calls } = fakeInterface({ parents: [KEY("users")] });
	await require(A).up(qi, Sequelize);
	const t = byName(calls);
	assert.deepEqual(t.telecaller_applications.status.type.values, ["draft", "pending", "more_info_requested", "approved", "rejected"]);
	assert.equal(t.telecaller_applications.status.defaultValue, "draft");
	assert.deepEqual(t.telecaller_applications.employment_preference.type.values, ["full_time", "part_time"]);
	assert.equal(t.telecaller_applications.confirmed_adult.allowNull, false);
	assert.equal(t.telecaller_applications.confirmed_adult.defaultValue, false);
	assert.equal(t.telecaller_applications.consented_privacy.defaultValue, false);
	assert.deepEqual(fk(t.telecaller_applications.user_id), { table: "users", key: "id", onDelete: "CASCADE" });
	assert.deepEqual(fk(t.telecaller_applications.decided_by), { table: "users", key: "id", onDelete: "SET NULL" });
	const ix = Object.fromEntries(calls.indexes.map((i) => [i.name, i]));
	assert.deepEqual([ix.uq_tcapp_user.cols, ix.uq_tcapp_user.unique], [["user_id"], true]);
	assert.equal(ix.uq_tcapp_user.unique, true);
	assert.equal(ix.uq_tcresume_version.unique, true);
	assert.ok(!("uq_tcresume_app" in ix), "there is no longer a one-resume-per-application constraint");
});

test("A: every event belongs to an attempt, and the history indexes follow it", async () => {
	const { Sequelize, qi, calls } = fakeInterface({ parents: [KEY("users")] });
	await require(A).up(qi, Sequelize);
	const t = byName(calls);
	const ev = t.telecaller_application_events;
	assert.equal(ev.attempt.allowNull, false, "an event without an attempt cannot be stored");
	assert.equal(ev.attempt.defaultValue, 1);
	assert.match(String(ev.attempt.type), /INTEGER/);
	assert.ok("attempt" in t.telecaller_applications, "the application row still carries its current attempt");
	const ix = Object.fromEntries(calls.indexes.map((i) => [i.name, i]));
	assert.deepEqual(ix.ix_tcevent_app.cols, ["application_id", "attempt", "created_at"]);
	assert.ok(!("updated_at" in ev), "events are append-only");
});

test("A: resumes are immutable versions tied to an attempt; a resubmission adds a row and never replaces one", async () => {
	const { Sequelize, qi, calls } = fakeInterface({ parents: [KEY("users")] });
	await require(A).up(qi, Sequelize);
	const r = byName(calls).telecaller_resumes;
	assert.equal(r.attempt.allowNull, false, "every resume is tied to an attempt");
	for (const c of ["original_filename", "mime_type", "size_bytes", "sha256", "uploaded_at", "data"]) assert.equal(r[c].allowNull, false, c);
	assert.equal(r.sha256.type.options.length, 64);
	assert.ok(!("updated_at" in r), "a stored resume is never updated");
	assert.ok(!("deleted_at" in r) && !("is_current" in r), "no soft delete and no mutable 'current' flag: the latest upload of an attempt is the current one");
	assert.deepEqual(fk(r.application_id), { table: "telecaller_applications", key: "id", onDelete: "CASCADE" });
	const ix = Object.fromEntries(calls.indexes.filter((i) => i.table === "telecaller_resumes").map((i) => [i.name, i]));
	// Many resumes per application and per attempt are allowed; only an identical file for the same attempt is deduplicated.
	assert.deepEqual([ix.uq_tcresume_version.cols, ix.uq_tcresume_version.unique], [["application_id", "attempt", "sha256"], true]);
	assert.deepEqual([ix.ix_tcresume_attempt.cols, !!ix.ix_tcresume_attempt.unique], [["application_id", "attempt", "uploaded_at"], false]);
	assert.deepEqual(Object.keys(ix).sort(), ["ix_tcresume_attempt", "uq_tcresume_version"]);
	assert.ok(!Object.values(ix).some((i) => i.unique && i.cols.length === 1), "no unique index on application_id alone (that would force one resume per application)");
});

test("A: profiles are keyed by user; resume bytes are a BLOB with size and hash recorded; history is append-only", async () => {
	const { Sequelize, qi, calls } = fakeInterface({ parents: [KEY("users")] });
	await require(A).up(qi, Sequelize);
	const t = byName(calls);
	assert.equal(t.telecaller_profiles.user_id.primaryKey, true);
	assert.deepEqual(fk(t.telecaller_profiles.user_id), { table: "users", key: "id", onDelete: "CASCADE" });
	assert.deepEqual(t.telecaller_profiles.status.type.values, ["active", "inactive"]);
	assert.equal(t.telecaller_profiles.status.defaultValue, "active");
	assert.match(String(t.telecaller_resumes.data.type).toUpperCase(), /BLOB/);
	assert.equal(t.telecaller_resumes.data.allowNull, false);
	for (const c of ["original_filename", "mime_type", "size_bytes", "sha256"]) assert.equal(t.telecaller_resumes[c].allowNull, false, c);
	assert.ok(!("updated_at" in t.telecaller_application_events));
});

test("B: follow-up statuses and ownership columns; 'completed' is only an explicit status, never derived from the clock", async () => {
	const { Sequelize, qi, calls } = fakeInterface({ parents: [KEY("users"), KEY("meeting_requests")] });
	await require(B).up(qi, Sequelize);
	const f = byName(calls).meeting_followups;
	assert.deepEqual(f.follow_up_status.type.values, ["not_contacted", "contacted", "follow_up_required", "meeting_confirmed", "not_interested", "unable_to_reach", "completed"]);
	assert.equal(f.meeting_request_id.primaryKey, true, "exactly one follow-up row per meeting");
	assert.deepEqual(fk(f.meeting_request_id), { table: "meeting_requests", key: "id", onDelete: "CASCADE" });
	for (const c of ["owner_user_id", "owned_at", "last_contacted_at", "next_follow_up_at", "completed_at", "completed_by", "completion_note", "version"]) assert.ok(c in f, c);
	assert.equal(f.version.defaultValue, 0, "compare-and-set ownership");
	assert.deepEqual(fk(f.owner_user_id), { table: "users", key: "id", onDelete: "SET NULL" });
	assert.doesNotMatch(code(B_SRC), /confirmed_end|NOW\(\)|CURDATE/, "no clock-derived completion in the schema");
});

test("B: call history and audit events are append-only, keep name snapshots, and block deleting a meeting that has history", async () => {
	const { Sequelize, qi, calls } = fakeInterface({ parents: [KEY("users"), KEY("meeting_requests")] });
	await require(B).up(qi, Sequelize);
	const t = byName(calls);
	for (const name of ["meeting_call_logs", "meeting_followup_events"]) {
		assert.ok(!("updated_at" in t[name]), `${name} has no updated_at`);
		assert.ok(!("deleted_at" in t[name]), `${name} has no soft delete`);
		assert.deepEqual(fk(t[name].meeting_request_id), { table: "meeting_requests", key: "id", onDelete: "RESTRICT" }, name);
	}
	assert.equal(t.meeting_call_logs.telecaller_name.allowNull, false);
	assert.equal(t.meeting_call_logs.notes.allowNull, false);
	assert.deepEqual(fk(t.meeting_call_logs.telecaller_user_id), { table: "users", key: "id", onDelete: "SET NULL" });
	assert.equal(t.meeting_followup_events.actor_name.allowNull, false);
	assert.deepEqual(t.meeting_followup_events.event_type.type.values, ["take", "transfer", "admin_assign", "admin_clear", "status_change", "completed"]);
	assert.deepEqual(t.meeting_followup_events.actor_role.type.values, ["telecaller", "admin"]);
	assert.deepEqual(t.meeting_call_logs.interest.type.values, ["high", "medium", "low", "none"]);
});

test("every foreign-key column is CHAR(36) BINARY, the same as users.id / meeting_requests.id", async () => {
	const { Sequelize, qi, calls } = fakeInterface({ parents: [KEY("users"), KEY("meeting_requests")] });
	await require(A).up(qi, Sequelize);
	await require(B).up(qi, Sequelize);
	assert.equal(calls.created.length, 7);
	for (const { cols } of calls.created) {
		for (const [name, c] of Object.entries(cols)) {
			if (c.references || name === "id") assert.equal(String(c.type), String(Sequelize.UUID), name);
		}
	}
});

test("A refuses to create anything when users.id is not what the foreign keys need", async () => {
	for (const parents of [[{ ...KEY("users"), co: "utf8mb4_0900_ai_ci" }], [{ ...KEY("users"), ty: "varchar(36)" }], [{ ...KEY("users"), cs: "latin1", co: "latin1_bin" }], []]) {
		const { Sequelize, qi, calls } = fakeInterface({ parents });
		await assert.rejects(require(A).up(qi, Sequelize), /[Nn]othing was created/);
		assert.deepEqual([calls.created, calls.indexes], [[], []]);
	}
});

test("B refuses to create anything when users.id or meeting_requests.id does not match", async () => {
	for (const parents of [
		[{ ...KEY("users"), co: "utf8mb4_0900_ai_ci" }, KEY("meeting_requests")],
		[KEY("users"), { ...KEY("meeting_requests"), cs: "latin1", co: "latin1_bin" }],
		[KEY("users"), { ...KEY("meeting_requests"), ty: "char(40)" }],
		[KEY("users")],
		[],
	]) {
		const { Sequelize, qi, calls } = fakeInterface({ parents });
		await assert.rejects(require(B).up(qi, Sequelize), /[Nn]othing was created/);
		assert.deepEqual([calls.created, calls.indexes], [[], []]);
	}
});

test("both are repeatable: re-running after they were applied changes nothing; a partial run adds only what is missing", async () => {
	for (const [file, tables, indexes] of [[A, A_TABLES, A_INDEXES], [B, B_TABLES, B_INDEXES]]) {
		const again = fakeInterface({ existing: tables, indexes });
		await require(file).up(again.qi, again.Sequelize);
		assert.deepEqual([again.calls.created, again.calls.indexes, again.calls.selects], [[], [], []]);

		const [first, ...rest] = tables;
		const partial = fakeInterface({ existing: [first], indexes: { [first]: [] }, parents: [KEY("users"), KEY("meeting_requests")] });
		await require(file).up(partial.qi, partial.Sequelize);
		assert.deepEqual(partial.calls.created.map((t) => t.name), rest, "only the missing tables are created");
		assert.ok(partial.calls.indexes.some((i) => i.table === first), "and the existing table still gets its missing indexes");
	}
});

test("down() drops only its own tables, children first, and nothing else", async () => {
	const a = fakeInterface();
	await require(A).down(a.qi);
	assert.deepEqual(a.calls.dropped, ["telecaller_resumes", "telecaller_profiles", "telecaller_application_events", "telecaller_applications"]);
	const b = fakeInterface();
	await require(B).down(b.qi);
	assert.deepEqual(b.calls.dropped, ["meeting_followup_events", "meeting_call_logs", "meeting_followups"]);
	for (const d of [a, b]) assert.deepEqual([d.calls.created, d.calls.indexes, d.calls.selects], [[], [], []]);
});

test("they sort after the last applied migration, and the real query interface renders valid DDL offline", async () => {
	assert.ok("20261027000000-create-telecaller-applications.js" > "20261026000000-create-student-removal-requests.js");
	assert.ok("20261028000000-create-meeting-followups.js" > "20261027000000-create-telecaller-applications.js");
	// The REAL Sequelize query interface with its final query() intercepted: every type, enum and key renders to SQL.
	const Sequelize = require("sequelize");
	const sequelize = new Sequelize("x", "x", "x", { dialect: "mysql", host: "127.0.0.1", logging: false });
	const sql = [];
	sequelize.query = async (q) => {
		const text = typeof q === "string" ? q : q.query;
		if (/information_schema\.COLUMNS/.test(text)) return [KEY("users"), KEY("meeting_requests")];
		if (/^\s*(CREATE|ALTER)/i.test(text)) sql.push(text);
		return [];
	};
	const qi = sequelize.getQueryInterface();
	qi.tableExists = async () => false;
	qi.showIndex = async () => [];
	await require(A).up(qi, Sequelize);
	await require(B).up(qi, Sequelize);
	const creates = sql.filter((s) => /^CREATE TABLE/i.test(s));
	assert.equal(creates.length, 7);
	assert.ok(creates.every((s) => /ENGINE=InnoDB DEFAULT CHARSET=utf8mb4/.test(s)));
	assert.ok(creates.every((s) => !/ENUM\s*[,)]/.test(s)), "every ENUM lists its values");
	const resumes = creates.find((s) => /CREATE TABLE IF NOT EXISTS `telecaller_resumes`/.test(s));
	assert.match(resumes, /`data` MEDIUMBLOB NOT NULL/);
	assert.match(resumes, /`attempt` INTEGER NOT NULL/);
	assert.doesNotMatch(resumes, /`updated_at`/);
	assert.match(creates.find((s) => /CREATE TABLE IF NOT EXISTS `telecaller_application_events`/.test(s)), /`attempt` INTEGER NOT NULL DEFAULT 1/);
	assert.equal(sql.filter((s) => /^ALTER TABLE/i.test(s)).length, 13);
	assert.equal(sql.filter((s) => /UNIQUE INDEX/.test(s)).length, 2);
});
