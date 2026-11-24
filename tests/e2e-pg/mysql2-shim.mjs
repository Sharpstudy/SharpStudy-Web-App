// Stand-in for `mysql2/promise` so the EXISTING end-to-end scripts (tests/e2e/*.mjs) can run, unchanged, against the isolated
// PostgreSQL test schema. It never opens a MySQL connection: the connection settings the scripts pass are ignored.
//
// The scripts were written for MySQL, so this shim translates exactly the MySQL-isms they use:
//   ?  placeholders (arrays expand for IN (?)), backtick quoting, camelCase column names (userId -> "userId"),
//   NOW()/UTC_TIMESTAMP()/DATE_ADD/DATE_SUB/UUID(), LIKE (MySQL is case-insensitive -> ILIKE), boolean = 0/1,
//   and returns rows the way mysql2 does (booleans as 1/0, COUNT as a number, [rows, fields] / [{ affectedRows }]).
// It refuses to run unless PG_SEARCH_PATH names a ss_e2e_ schema, and checks that `public` is not reachable.
import pg from "pg";

const schema = process.env.PG_SEARCH_PATH || "";
const pgTypes = pg.types;
const parsers = { getTypeParser: (oid, fmt) => (oid === 20 || oid === 1700 ? (v) => Number(v) : oid === 1082 ? (v) => v : pgTypes.getTypeParser(oid, fmt)) };

let meta = null; // { booleans:Set, camel:Set }
async function loadMeta(client) {
	if (meta) return meta;
	const r = await client.query("select table_name, column_name, data_type from information_schema.columns where table_schema = current_schema()");
	const boolByTable = new Map();
	for (const x of r.rows) if (x.data_type === "boolean") (boolByTable.get(x.table_name) || boolByTable.set(x.table_name, new Set()).get(x.table_name)).add(x.column_name);
	meta = { boolByTable, booleans: new Set(r.rows.filter((x) => x.data_type === "boolean").map((x) => x.column_name)), camel: new Set(r.rows.map((x) => x.column_name).filter((n) => /[A-Z]/.test(n))) };
	return meta;
}

// split on commas that are not inside quotes or parentheses
function splitTop(text) {
	const parts = [];
	let depth = 0, quote = null, cur = "";
	for (let i = 0; i < text.length; i++) {
		const ch = text[i];
		if (quote) {
			cur += ch;
			if (ch === quote && text[i + 1] === quote) cur += text[++i];
			else if (ch === quote) quote = null;
			continue;
		}
		if (ch === "'" || ch === '"') {
			quote = ch;
			cur += ch;
		} else if (ch === "(") {
			depth++;
			cur += ch;
		} else if (ch === ")") {
			depth--;
			cur += ch;
		} else if (ch === "," && depth === 0) {
			parts.push(cur);
			cur = "";
		} else cur += ch;
	}
	parts.push(cur);
	return parts;
}

// INSERT INTO t (a, b, c) VALUES (?, 0, 'x'): MySQL accepts 0/1 for a boolean column, PostgreSQL does not -> true/false
function fixInsertBooleans(sql, m) {
	const x = /^(\s*INSERT\s+INTO\s+`?(\w+)`?\s*\()([^)]*)(\)\s*VALUES\s*\()([\s\S]*)(\)\s*)$/i.exec(sql);
	if (!x) return sql;
	const bools = m.boolByTable.get(x[2]);
	if (!bools) return sql;
	const cols = x[3].split(",").map((c) => c.trim().replace(/[`"]/g, ""));
	const vals = splitTop(x[5]);
	if (vals.length !== cols.length) return sql;
	const fixed = vals.map((v, i) => (bools.has(cols[i]) && /^\s*[01]\s*$/.test(v) ? (v.trim() === "1" ? " true" : " false") : v));
	return x[1] + x[3] + x[4] + fixed.join(",") + x[6];
}

// split SQL into string literals (kept as they are) and code (translated)
function translate(sql, params, m) {
	sql = fixInsertBooleans(sql, m);
	const out = [];
	const bind = [];
	const parts = sql.split(/('(?:[^'\\]|\\.|'')*')/);
	let p = 0;
	for (let i = 0; i < parts.length; i++) {
		let s = parts[i];
		if (i % 2 === 1) {
			out.push(s);
			continue;
		}
		s = s.replace(/`/g, '"');
		s = s.replace(/\bUUID\(\)/gi, "gen_random_uuid()");
		s = s.replace(/table_schema\s*=\s*DATABASE\(\)/gi, "table_schema = current_schema()"); // introspection of the pinned test schema
		s = s.replace(/\bDATABASE\(\)/gi, "'sharpstudy_dev'"); // the scripts only compare the name; the connection is pinned to the test schema anyway
		s = s.replace(/\bUTC_TIMESTAMP\(\d?\)/gi, "CURRENT_TIMESTAMP");
		s = s.replace(/\bDATE_(SUB|ADD)\(\s*(CURRENT_TIMESTAMP|NOW\(\))\s*,\s*INTERVAL\s+(\d+)\s+(\w+)\s*\)/gi, (_, op, base, n, unit) => `(${base} ${op.toUpperCase() === "SUB" ? "-" : "+"} INTERVAL '${n} ${unit}')`);
		s = s.replace(/\bLIKE\b/g, "ILIKE");
		for (const col of m.booleans) s = s.replace(new RegExp(`(?<!["\\w.])(${col})(\\s*(?:=|<>|!=)\\s*)([01])\\b(?!\\.)`, "g"), (_, c, op, v) => `${c}${op}${v === "1" ? "true" : "false"}`);
		for (const col of m.camel) s = s.replace(new RegExp(`(?<![\\w"])${col}(?![\\w"])`, "g"), `"${col}"`);
		// placeholders
		s = s.replace(/\?/g, () => {
			const v = params[p++];
			if (Array.isArray(v)) {
				if (!v.length) return "NULL";
				// the scripts use the string "-" as "an id that matches nothing" for empty lists; a uuid column needs a real uuid (the nil UUID matches nothing too)
				return v.map((x) => (bind.push(x === "-" ? "00000000-0000-0000-0000-000000000000" : x), `$${bind.length}`)).join(", ");
			}
			bind.push(v === undefined ? null : v);
			return `$${bind.length}`;
		});
		out.push(s);
	}
	return { text: out.join(""), values: bind };
}

const asMysqlRow = (row) => {
	const o = {};
	for (const [k, v] of Object.entries(row)) o[k] = v === true ? 1 : v === false ? 0 : v;
	return o;
};

class ShimConnection {
	constructor(client) {
		this.client = client;
	}
	async query(sql, params = []) {
		if (typeof sql === "object") {
			params = sql.values || params;
			sql = sql.sql;
		}
		const m = await loadMeta(this.client);
		if (/^\s*SET\s/i.test(sql)) return [{ affectedRows: 0 }, undefined];
		const show = /^\s*SHOW\s+COLUMNS\s+FROM\s+`?(\w+)`?\s*$/i.exec(sql);
		if (show) {
			const res = await this.client.query('select column_name as "Field" from information_schema.columns where table_schema = current_schema() and table_name = $1 order by ordinal_position', [show[1]]);
			return [res.rows, res.fields];
		}
		const { text, values } = translate(sql, params, m);
		const res = await this.client.query({ text, values });
		if (res.command === "SELECT" || (res.rows && res.fields && res.fields.length)) return [res.rows.map(asMysqlRow), res.fields];
		return [{ affectedRows: res.rowCount, insertId: 0 }, undefined];
	}
	execute(sql, params) {
		return this.query(sql, params);
	}
	beginTransaction() {
		return this.client.query("BEGIN");
	}
	commit() {
		return this.client.query("COMMIT");
	}
	rollback() {
		return this.client.query("ROLLBACK");
	}
	async end() {
		await this.client.end();
	}
}

export async function createConnection() {
	if (!/^ss_e2e_[0-9a-f]{10}$/.test(schema)) throw new Error("mysql2 shim: PG_SEARCH_PATH must name a ss_e2e_ test schema (refusing to run against anything else)");
	const client = new pg.Client({
		host: process.env.PG_HOST || "localhost",
		port: Number(process.env.PG_PORT) || 5432,
		database: process.env.PG_DATABASE || "sharpstudy_dev",
		user: process.env.PG_USER || "sharpstudy_dev",
		...(process.env.PG_PASSWORD ? { password: process.env.PG_PASSWORD } : {}),
		options: `-c search_path=${schema}`,
		types: parsers,
	});
	await client.connect();
	await client.query("SET TIME ZONE 'UTC'");
	const r = (await client.query("select current_schema() as s, current_setting('search_path') as p")).rows[0];
	if (r.s !== schema || r.p !== schema) throw new Error("mysql2 shim: connection is not pinned to the test schema");
	return new ShimConnection(client);
}

export const createPool = createConnection;
export default { createConnection, createPool };
