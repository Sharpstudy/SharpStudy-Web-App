// Logical backup of the configured database as plain files (for machines without pg_dump/mysqldump).
//   npx env-cmd node scripts/db/backup-json.mjs <output-directory>
//
// SELECT statements only: it never writes to the database. For every table it writes <table>.json (column metadata + every row) and finally
// manifest.json (row counts and a SHA-256 of each file). It then re-counts every table in the database and compares: the exit code is 0 only
// when every file's row count equals the live count and every file hashes to what the manifest says. The output contains real user data
// (including password hashes): keep it outside the repository and treat it as sensitive.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import connection from "../../database/connection.js";

const out = process.argv[2];
if (!out) {
	console.error("usage: node scripts/db/backup-json.mjs <output-directory>");
	process.exit(2);
}
const dialect = connection.getDialect();
if (dialect !== "postgres" && dialect !== "mysql") {
	console.error(`unsupported dialect ${dialect}`);
	process.exit(2);
}
if (fs.existsSync(out) && fs.readdirSync(out).length) {
	console.error(`refusing: ${out} already contains files (a backup is never overwritten)`);
	process.exit(2);
}
fs.mkdirSync(out, { recursive: true });

const q = async (sql) => (await connection.query(sql))[0];
const ident = (n) => (dialect === "postgres" ? `"${n.replace(/"/g, '""')}"` : `\`${n.replace(/`/g, "``")}\``);
const tables =
	dialect === "postgres"
		? (await q("SELECT table_name AS t FROM information_schema.tables WHERE table_schema = current_schema() AND table_type = 'BASE TABLE' ORDER BY 1")).map((r) => r.t)
		: (await q("SELECT table_name AS t FROM information_schema.tables WHERE table_schema = DATABASE() AND table_type = 'BASE TABLE' ORDER BY 1")).map((r) => r.t);

const replacer = (k, v) => (typeof v === "bigint" ? v.toString() : Buffer.isBuffer(v) ? { $buffer: v.toString("base64") } : v);
const sha = (f) => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const manifest = { dialect, database: (await q(dialect === "postgres" ? "SELECT current_database() AS d" : "SELECT DATABASE() AS d"))[0].d, createdAt: new Date().toISOString(), tables: {} };

for (const t of tables) {
	const columns = await q(
		dialect === "postgres"
			? `SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = '${t.replace(/'/g, "''")}' ORDER BY ordinal_position`
			: `SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = '${t.replace(/'/g, "''")}' ORDER BY ordinal_position`
	);
	const rows = await q(`SELECT * FROM ${ident(t)}`);
	const file = path.join(out, `${t}.json`);
	fs.writeFileSync(file, JSON.stringify({ table: t, columns, rows }, replacer));
	manifest.tables[t] = { rows: rows.length, sha256: sha(file) };
}
fs.writeFileSync(path.join(out, "manifest.json"), JSON.stringify(manifest, null, 2));

// Verification: live counts and file hashes must match the manifest, and re-reading each file must give the same row count.
let bad = 0;
for (const t of tables) {
	const live = Number((await q(`SELECT COUNT(*) AS n FROM ${ident(t)}`))[0].n);
	const file = path.join(out, `${t}.json`);
	const again = JSON.parse(fs.readFileSync(file, "utf8")).rows.length;
	const ok = live === manifest.tables[t].rows && again === live && sha(file) === manifest.tables[t].sha256;
	if (!ok) {
		bad++;
		console.error(`MISMATCH ${t}: live=${live} manifest=${manifest.tables[t].rows} file=${again}`);
	}
}
const total = Object.values(manifest.tables).reduce((a, b) => a + b.rows, 0);
console.log(`database ${manifest.database} (${dialect}): ${tables.length} tables, ${total} rows -> ${out}`);
console.log(bad ? `VERIFICATION FAILED for ${bad} table(s)` : "verification passed: every table's row count and SHA-256 match");
await connection.close();
process.exit(bad ? 1 : 0);
