// Migration 20261029000000: one nullable JSON column, form_snapshot, on telecaller_application_events. A recording stand-in
// for the query interface is used, so no database is touched and nothing is migrated by running these.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const FILE = "database/migrations/20261029000000-add-form-snapshot-to-telecaller-events.js";
const MIGRATION = `../../${FILE}`;
const source = readFileSync(new URL(`../../${FILE}`, import.meta.url), "utf8");
const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/.*$/gm, "$1");
const TABLE = "telecaller_application_events";
const BASE_COLUMNS = { id: {}, application_id: {}, attempt: {}, from_status: {}, to_status: {}, actor: {}, actor_user_id: {}, feedback: {}, internal_note: {}, email_status: {}, created_at: {} };

function fakeInterface({ tables = [TABLE], columns = BASE_COLUMNS } = {}) {
	const Sequelize = require("sequelize");
	const calls = { added: [], removed: [], created: [], dropped: [], changed: [], indexes: [], raw: [] };
	const qi = {
		sequelize: { query: async (sql) => calls.raw.push(sql) },
		tableExists: async (n) => tables.includes(n),
		describeTable: async () => columns,
		addColumn: async (table, name, def) => calls.added.push({ table, name, def }),
		removeColumn: async (table, name) => calls.removed.push({ table, name }),
		createTable: async (n) => calls.created.push(n),
		dropTable: async (n) => calls.dropped.push(n),
		changeColumn: async (...a) => calls.changed.push(a),
		addIndex: async (...a) => calls.indexes.push(a),
	};
	return { Sequelize, qi, calls };
}

test("up adds exactly one nullable JSON column to telecaller_application_events and nothing else", async () => {
	const { Sequelize, qi, calls } = fakeInterface();
	await require(MIGRATION).up(qi, Sequelize);
	assert.equal(calls.added.length, 1);
	assert.equal(calls.added[0].table, TABLE);
	assert.equal(calls.added[0].name, "form_snapshot");
	assert.equal(String(calls.added[0].def.type), String(Sequelize.JSON));
	assert.equal(calls.added[0].def.allowNull, true, "nullable: existing events keep working with NULL");
	assert.ok(!("defaultValue" in calls.added[0].def), "no default, so no existing row is rewritten");
	assert.deepEqual([calls.removed, calls.created, calls.dropped, calls.changed, calls.indexes, calls.raw], [[], [], [], [], [], []]);
});

test("it is repeatable: when the column already exists, nothing is issued", async () => {
	const { Sequelize, qi, calls } = fakeInterface({ columns: { ...BASE_COLUMNS, form_snapshot: {} } });
	await require(MIGRATION).up(qi, Sequelize);
	assert.deepEqual([calls.added, calls.removed, calls.created, calls.raw], [[], [], [], []]);
});

test("it stops, having changed nothing, when the events table does not exist yet", async () => {
	const { Sequelize, qi, calls } = fakeInterface({ tables: [] });
	await assert.rejects(require(MIGRATION).up(qi, Sequelize), /nothing was changed/i);
	assert.deepEqual([calls.added, calls.created, calls.raw], [[], [], []]);
});

test("down removes only that column, only when it is there, and touches nothing else", async () => {
	const withColumn = fakeInterface({ columns: { ...BASE_COLUMNS, form_snapshot: {} } });
	await require(MIGRATION).down(withColumn.qi);
	assert.deepEqual(withColumn.calls.removed, [{ table: TABLE, name: "form_snapshot" }]);
	assert.deepEqual([withColumn.calls.added, withColumn.calls.dropped, withColumn.calls.created], [[], [], []]);
	const without = fakeInterface();
	await require(MIGRATION).down(without.qi);
	assert.deepEqual(without.calls.removed, [], "nothing to remove");
	const noTable = fakeInterface({ tables: [] });
	await require(MIGRATION).down(noTable.qi);
	assert.deepEqual(noTable.calls.removed, []);
});

test("the migration code contains no destructive statement other than its own down(), and names only the one table and column", () => {
	assert.doesNotMatch(code, /dropTable|createTable|changeColumn|renameColumn|renameTable|addIndex|removeIndex|bulkDelete|bulkInsert|truncate|DELETE FROM|UPDATE |INSERT /i);
	assert.equal((code.match(/removeColumn\(/g) || []).length, 1, "removeColumn appears once, in down()");
	assert.equal((code.match(/addColumn\(/g) || []).length, 1);
	assert.deepEqual([...new Set(code.match(/"[a-z_]+"/g))].sort(), ['"form_snapshot"', '"internal_note"', '"telecaller_application_events"'].sort());
	assert.doesNotMatch(code, /\busers\b|meeting_requests|"role"/);
});

test("it sorts after the last migration of this feature and renders to a single valid ALTER statement", async () => {
	assert.ok("20261029000000-add-form-snapshot-to-telecaller-events.js" > "20261028000000-create-meeting-followups.js");
	// The REAL Sequelize query interface with its final query() intercepted: proves the column definition renders to SQL.
	const Sequelize = require("sequelize");
	const sequelize = new Sequelize("x", "x", "x", { dialect: "mysql", host: "127.0.0.1", logging: false });
	const sql = [];
	sequelize.query = async (q) => {
		const text = typeof q === "string" ? q : q.query;
		if (/^\s*(ALTER|CREATE|DROP)/i.test(text)) sql.push(text);
		return [[], []];
	};
	const qi = sequelize.getQueryInterface();
	qi.tableExists = async () => true;
	qi.describeTable = async () => BASE_COLUMNS;
	await require(MIGRATION).up(qi, Sequelize);
	assert.equal(sql.length, 1);
	assert.match(sql[0], /^ALTER TABLE `telecaller_application_events` ADD `form_snapshot` JSON AFTER `internal_note`;?$/);
	assert.doesNotMatch(sql[0], /NOT NULL|DEFAULT/);
	sql.length = 0;
	qi.describeTable = async () => ({ ...BASE_COLUMNS, form_snapshot: {} });
	await require(MIGRATION).down(qi);
	assert.equal(sql.length, 1);
	assert.match(sql[0], /^ALTER TABLE `telecaller_application_events` DROP `form_snapshot`;?$/);
});
