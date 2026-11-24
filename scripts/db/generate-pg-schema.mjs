// Generates the PostgreSQL baseline schema (SQL files) from the REAL MySQL database's information_schema.
// Read-only against MySQL. Writes only:
//   database/migrations-pg/sql/001_tables.sql / .down.sql
//   database/migrations-pg/sql/002_indexes.sql / .down.sql
//   database/migrations-pg/sql/003_foreign_keys.sql / .down.sql
//   docs/postgres/schema-mapping.md
//
//   yarn db:generate-pg-schema      (MySQL credentials come from .env through env-cmd; nothing is printed)
//
// The migrations in database/migrations-pg execute these files. Regenerating from an unchanged MySQL schema
// produces byte-identical files, so a diff in version control shows exactly what changed.
import fs from "node:fs";
import path from "node:path";
import mysql from "mysql2/promise";
import { IDENT, LIT, mapType, mapDefault, buildIndexNames, enumCheckName, pkName, orderTables } from "./lib/pg-schema-map.mjs";

const root = process.cwd();
const sqlDir = path.join(root, "database", "migrations-pg", "sql");
const docFile = path.join(root, "docs", "postgres", "schema-mapping.md");
// sequelize-cli's own bookkeeping table is created by sequelize-cli in PostgreSQL (migrationStorageTableName), not here.
const SKIP_TABLES = new Set(["sequelizemeta"]);

const c = await mysql.createConnection({
	host: process.env.DB_HOSTNAME,
	port: Number(process.env.DB_PORT) || 3306,
	user: process.env.DB_USERNAME,
	password: process.env.DB_PASSWORD,
	database: process.env.DB_NAME_DEVELOPMENT,
});

try {
	await c.query("SET SESSION TRANSACTION READ ONLY");
	const q = async (sql) => (await c.query(sql))[0];
	const lower = (rows) => rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k.toLowerCase(), v])));

	const tables = lower(
		await q("SELECT table_name FROM information_schema.tables WHERE table_schema = DATABASE() AND table_type = 'BASE TABLE' ORDER BY table_name")
	)
		.map((r) => r.table_name)
		.filter((t) => !SKIP_TABLES.has(t));
	const columns = lower(
		await q(
			"SELECT table_name, column_name, column_type, is_nullable, column_default, extra FROM information_schema.columns WHERE table_schema = DATABASE() ORDER BY table_name, ordinal_position"
		)
	);
	const stats = lower(
		await q(
			"SELECT table_name, index_name, non_unique, seq_in_index, column_name, sub_part, collation, expression FROM information_schema.statistics WHERE table_schema = DATABASE() ORDER BY table_name, index_name, seq_in_index"
		)
	);
	const fks = lower(
		await q(
			"SELECT k.table_name, k.column_name, k.constraint_name, k.referenced_table_name, k.referenced_column_name, k.ordinal_position, r.delete_rule, r.update_rule FROM information_schema.key_column_usage k JOIN information_schema.referential_constraints r ON r.constraint_name = k.constraint_name AND r.constraint_schema = k.constraint_schema WHERE k.table_schema = DATABASE() AND k.referenced_table_name IS NOT NULL ORDER BY k.table_name, k.constraint_name, k.ordinal_position"
		)
	);

	// Refuse constructs this generator does not translate, instead of silently dropping them.
	if (stats.some((s) => s.sub_part !== null || s.collation === "D" || s.expression !== null)) throw new Error("Prefix, descending or expression indexes are not supported by this generator");
	if (columns.some((x) => x.extra && !/^DEFAULT_GENERATED$/i.test(x.extra) && x.extra !== "")) throw new Error("Unsupported column attribute (auto-increment / generated / on update)");

	const colsBy = new Map();
	for (const x of columns) {
		if (SKIP_TABLES.has(x.table_name)) continue;
		if (!colsBy.has(x.table_name)) colsBy.set(x.table_name, []);
		colsBy.get(x.table_name).push(x);
	}

	// group index rows into indexes
	const idx = new Map();
	for (const s of stats) {
		if (SKIP_TABLES.has(s.table_name)) continue;
		const key = `${s.table_name}.${s.index_name}`;
		if (!idx.has(key)) idx.set(key, { t: s.table_name, n: s.index_name, unique: Number(s.non_unique) === 0, cols: [] });
		idx.get(key).cols.push(s.column_name);
	}
	const primary = new Map();
	const secondary = [];
	for (const i of idx.values()) (i.n === "PRIMARY" ? (primary.set(i.t, i.cols), null) : secondary.push(i));
	const names = buildIndexNames(secondary);

	// group foreign keys
	const fkMap = new Map();
	for (const f of fks) {
		const key = `${f.table_name}.${f.constraint_name}`;
		if (!fkMap.has(key)) fkMap.set(key, { t: f.table_name, n: f.constraint_name, rt: f.referenced_table_name, cols: [], rcols: [], del: f.delete_rule, upd: f.update_rule });
		fkMap.get(key).cols.push(f.column_name);
		fkMap.get(key).rcols.push(f.referenced_column_name);
	}
	const fkList = [...fkMap.values()];

	// relation names (tables, primary-key indexes, unique constraints, indexes) share one namespace in PostgreSQL
	const relNames = new Set(tables);
	for (const t of tables) if (!primary.has(t)) throw new Error(`Table without primary key: ${t}`);
	for (const t of tables) relNames.add(pkName(t));
	for (const i of secondary) {
		const nm = names.get(`${i.t}.${i.n}`);
		if (relNames.has(nm)) throw new Error(`PostgreSQL name collision: ${nm}`);
		relNames.add(nm);
	}

	const order = orderTables(tables, fkList);
	const stamp = "-- GENERATED by scripts/db/generate-pg-schema.mjs from the MySQL information_schema. Do not edit by hand.\n";

	// ---- 001 tables
	const stats1 = { types: {}, enums: 0, checks: 0 };
	let tablesSql = stamp + "-- PostgreSQL baseline: tables, primary keys, defaults, NOT NULL and enum CHECK constraints.\n\n";
	const mappingRows = [];
	for (const t of order) {
		const lines = [];
		const checks = [];
		for (const col of colsBy.get(t)) {
			const mapped = mapType(col.column_type);
			const def = mapDefault(mapped, col.column_default);
			stats1.types[`${col.column_type.replace(/\(.*\)/, "(n)")} -> ${mapped.sql.replace(/\(.*\)/, "(n)")}`] = (stats1.types[`${col.column_type.replace(/\(.*\)/, "(n)")} -> ${mapped.sql.replace(/\(.*\)/, "(n)")}`] || 0) + 1;
			lines.push(`  ${IDENT(col.column_name)} ${mapped.sql}${col.is_nullable === "NO" ? " NOT NULL" : ""}${def ? " DEFAULT " + def.sql : ""}`);
			if (mapped.kind === "enum") {
				stats1.enums++;
				checks.push(`  CONSTRAINT ${IDENT(enumCheckName(t, col.column_name))} CHECK (${IDENT(col.column_name)} IN (${mapped.enumValues.map(LIT).join(", ")}))`);
			}
			mappingRows.push({ t, c: col.column_name, my: col.column_type, pg: mapped.sql });
		}
		stats1.checks += checks.length;
		lines.push(`  CONSTRAINT ${IDENT(pkName(t))} PRIMARY KEY (${primary.get(t).map(IDENT).join(", ")})`);
		lines.push(...checks);
		tablesSql += `CREATE TABLE ${IDENT(t)} (\n${lines.join(",\n")}\n);\n\n`;
	}
	const tablesDown = stamp + "-- Reverse of 001_tables.sql (drops every table created there; parents last).\n\n" + [...order].reverse().map((t) => `DROP TABLE ${IDENT(t)};`).join("\n") + "\n";

	// ---- 002 indexes
	const uniq = secondary.filter((i) => i.unique);
	const plain = secondary.filter((i) => !i.unique);
	let idxSql = stamp + "-- PostgreSQL baseline: unique constraints and secondary indexes (MySQL index names are made schema-unique).\n\n";
	idxSql += "-- unique constraints\n";
	for (const i of uniq) idxSql += `ALTER TABLE ${IDENT(i.t)} ADD CONSTRAINT ${IDENT(names.get(`${i.t}.${i.n}`))} UNIQUE (${i.cols.map(IDENT).join(", ")});\n`;
	idxSql += "\n-- non-unique indexes\n";
	for (const i of plain) idxSql += `CREATE INDEX ${IDENT(names.get(`${i.t}.${i.n}`))} ON ${IDENT(i.t)} (${i.cols.map(IDENT).join(", ")});\n`;
	let idxDown = stamp + "-- Reverse of 002_indexes.sql.\n\n";
	for (const i of plain) idxDown += `DROP INDEX ${IDENT(names.get(`${i.t}.${i.n}`))};\n`;
	for (const i of uniq) idxDown += `ALTER TABLE ${IDENT(i.t)} DROP CONSTRAINT ${IDENT(names.get(`${i.t}.${i.n}`))};\n`;

	// ---- 003 foreign keys
	const rule = (r) => {
		if (!["CASCADE", "RESTRICT", "SET NULL", "NO ACTION"].includes(r)) throw new Error(`Unsupported FK rule: ${r}`);
		return r;
	};
	let fkSql = stamp + "-- PostgreSQL baseline: foreign keys (added after all tables and indexes exist).\n\n";
	let fkDown = stamp + "-- Reverse of 003_foreign_keys.sql.\n\n";
	for (const f of fkList.sort((a, b) => (a.t + a.n).localeCompare(b.t + b.n))) {
		fkSql += `ALTER TABLE ${IDENT(f.t)} ADD CONSTRAINT ${IDENT(f.n)} FOREIGN KEY (${f.cols.map(IDENT).join(", ")}) REFERENCES ${IDENT(f.rt)} (${f.rcols.map(IDENT).join(", ")}) ON DELETE ${rule(f.del)} ON UPDATE ${rule(f.upd)};\n`;
		fkDown += `ALTER TABLE ${IDENT(f.t)} DROP CONSTRAINT ${IDENT(f.n)};\n`;
	}

	fs.mkdirSync(sqlDir, { recursive: true });
	const write = (n, s) => fs.writeFileSync(path.join(sqlDir, n), s.replace(/\r\n/g, "\n"));
	write("001_tables.sql", tablesSql);
	write("001_tables.down.sql", tablesDown);
	write("002_indexes.sql", idxSql);
	write("002_indexes.down.sql", idxDown);
	write("003_foreign_keys.sql", fkSql);
	write("003_foreign_keys.down.sql", fkDown);

	// ---- documentation
	const renamed = secondary.filter((i) => names.get(`${i.t}.${i.n}`) !== i.n);
	let md = "# MySQL to PostgreSQL schema mapping\n\nGenerated by `scripts/db/generate-pg-schema.mjs` from the MySQL `information_schema` of `sharpstudy_dev`. Do not edit by hand.\n\n";
	md += `- Tables: **${tables.length}** application tables (plus sequelize-cli's \`sequelizemeta\`, created by sequelize-cli)\n`;
	md += `- Columns: **${mappingRows.length}**\n- Primary keys: **${primary.size}**\n- Unique constraints: **${uniq.length}**\n- Non-unique indexes: **${plain.length}**\n- Foreign keys: **${fkList.length}**\n- Enum CHECK constraints: **${stats1.checks}**\n\n`;
	md += "## Column type conversions\n\n| MySQL | PostgreSQL | Columns |\n|---|---|---|\n";
	for (const [k, v] of Object.entries(stats1.types).sort((a, b) => b[1] - a[1])) md += `| ${k.split(" -> ")[0]} | ${k.split(" -> ")[1]} | ${v} |\n`;
	md += `\n## Indexes renamed (PostgreSQL index names must be unique per schema)\n\n${renamed.length} of ${secondary.length} secondary indexes were prefixed with their table name because the MySQL name was reused by another table.\n\n| Table | MySQL name | PostgreSQL name |\n|---|---|---|\n`;
	for (const i of renamed) md += `| ${i.t} | ${i.n} | ${names.get(`${i.t}.${i.n}`)} |\n`;
	fs.mkdirSync(path.dirname(docFile), { recursive: true });
	fs.writeFileSync(docFile, md.replace(/\r\n/g, "\n"));

	console.log(`tables ${tables.length} | columns ${mappingRows.length} | pk ${primary.size} | unique ${uniq.length} | indexes ${plain.length} | fks ${fkList.length} | enum checks ${stats1.checks} | renamed indexes ${renamed.length}`);
} finally {
	await c.end();
}
