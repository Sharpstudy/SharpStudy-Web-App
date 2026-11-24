// Pure MySQL -> PostgreSQL schema mapping rules, shared by the schema generator
// (scripts/db/generate-pg-schema.mjs) and the validator (scripts/db/compare-schema.mjs).
// No database access happens here, so every rule can be unit-tested (tests/db/schema-map.test.mjs).
//
// Mapping decisions (see docs/postgres/schema-mapping.md):
//   char(36)                 -> uuid           (every value in the source was validated as a UUID)
//   char(n) / varchar(n)     -> char(n) / varchar(n)
//   text / mediumtext        -> text
//   int / tinyint / tinyint(1) -> integer / smallint / boolean
//   float                    -> real           (same 4-byte IEEE single precision as MySQL FLOAT)
//   datetime / datetime(n)   -> timestamptz / timestamptz(n)   (values are stored as UTC)
//   date                     -> date           (no time zone, never converted)
//   json                     -> jsonb
//   mediumblob               -> bytea
//   enum(...)                -> varchar(n) + CHECK (col IN (...))

import { createHash } from "node:crypto";

export const IDENT = (s) => '"' + String(s).replace(/"/g, '""') + '"';
export const LIT = (s) => "'" + String(s).replace(/'/g, "''") + "'";

// Values of a MySQL enum column type: enum('a','b') -> ["a", "b"]
export function parseEnum(columnType) {
	const m = /^enum\((.*)\)$/is.exec(String(columnType).trim());
	if (!m) throw new Error(`Not an enum type: ${columnType}`);
	const values = [];
	const re = /'((?:[^']|'')*)'/g;
	let x;
	while ((x = re.exec(m[1]))) values.push(x[1].replace(/''/g, "'"));
	if (!values.length) throw new Error(`Enum without values: ${columnType}`);
	return values;
}

// -> { kind, sql, fmt, enumValues? }
//   sql: type as written in CREATE TABLE.  fmt: what PostgreSQL's format_type() reports back.
export function mapType(columnType) {
	const t = String(columnType).toLowerCase().trim();
	let m;
	if (t === "char(36)") return { kind: "uuid", sql: "uuid", fmt: "uuid" };
	if ((m = /^char\((\d+)\)$/.exec(t))) return { kind: "char", sql: `char(${m[1]})`, fmt: `character(${m[1]})` };
	if ((m = /^varchar\((\d+)\)$/.exec(t))) return { kind: "varchar", sql: `varchar(${m[1]})`, fmt: `character varying(${m[1]})` };
	if (["text", "mediumtext", "longtext", "tinytext"].includes(t)) return { kind: "text", sql: "text", fmt: "text" };
	if (t === "int" || t === "integer") return { kind: "integer", sql: "integer", fmt: "integer" };
	if (t === "tinyint(1)") return { kind: "boolean", sql: "boolean", fmt: "boolean" };
	if (t === "tinyint" || t === "smallint") return { kind: "smallint", sql: "smallint", fmt: "smallint" };
	if (t === "bigint") return { kind: "bigint", sql: "bigint", fmt: "bigint" };
	if (t === "float") return { kind: "real", sql: "real", fmt: "real" };
	if (t === "double") return { kind: "double", sql: "double precision", fmt: "double precision" };
	if (t === "datetime") return { kind: "timestamptz", sql: "timestamptz", fmt: "timestamp with time zone" };
	if ((m = /^datetime\((\d)\)$/.exec(t))) return { kind: "timestamptz", sql: `timestamptz(${m[1]})`, fmt: `timestamp(${m[1]}) with time zone` };
	if (t === "date") return { kind: "date", sql: "date", fmt: "date" };
	if (t === "json") return { kind: "jsonb", sql: "jsonb", fmt: "jsonb" };
	if (["mediumblob", "blob", "longblob", "tinyblob"].includes(t)) return { kind: "bytea", sql: "bytea", fmt: "bytea" };
	if (t.startsWith("enum(")) {
		const enumValues = parseEnum(columnType);
		const width = Math.max(32, ...enumValues.map((v) => v.length));
		return { kind: "enum", sql: `varchar(${width})`, fmt: `character varying(${width})`, enumValues };
	}
	throw new Error(`Unmapped MySQL type "${columnType}" - add an explicit rule instead of guessing`);
}

// MySQL information_schema COLUMN_DEFAULT -> { sql, norm } or null (no default).
// `norm` is the form compared against what PostgreSQL reports: str:<value> for strings, otherwise the SQL text.
export function mapDefault(mapped, columnDefault) {
	if (columnDefault === null || columnDefault === undefined) return null;
	const df = String(columnDefault);
	switch (mapped.kind) {
		case "timestamptz": {
			if (!/^CURRENT_TIMESTAMP(\(\d\))?$/i.test(df)) throw new Error(`Unsupported datetime default: ${df}`);
			const up = df.toUpperCase();
			return { sql: up, norm: up };
		}
		case "boolean": {
			if (df !== "0" && df !== "1") throw new Error(`Unsupported boolean default: ${df}`);
			const v = df === "1" ? "true" : "false";
			return { sql: v, norm: v };
		}
		case "integer":
		case "smallint":
		case "bigint":
		case "real":
		case "double": {
			if (!/^-?\d+(\.\d+)?$/.test(df)) throw new Error(`Unsupported numeric default: ${df}`);
			return { sql: df, norm: df };
		}
		case "uuid":
		case "char":
		case "varchar":
		case "text":
		case "enum":
			return { sql: LIT(df), norm: `str:${df}` };
		default:
			throw new Error(`No default rule for ${mapped.kind}: ${df}`);
	}
}

// What PostgreSQL's pg_get_expr() reports for a default -> the same `norm` form as mapDefault.
export function normalizePgDefault(expr) {
	if (expr === null || expr === undefined) return null;
	const s = String(expr).trim();
	const m = /^'((?:[^']|'')*)'(?:::[\w\s"[\]]+)?$/.exec(s);
	if (m) return `str:${m[1].replace(/''/g, "'")}`;
	return /^current_timestamp/i.test(s) ? s.toUpperCase() : s;
}

const fit63 = (name) => {
	if (name.length <= 63) return name;
	return name.slice(0, 54) + "_" + createHash("sha1").update(name).digest("hex").slice(0, 8);
};

// PostgreSQL index/constraint names live in one namespace per schema (MySQL's are per table).
// Keep the MySQL name when it is unique across the whole database, otherwise prefix the table name.
// `indexes`: [{ t, n }] (one entry per index; PRIMARY excluded).
export function buildIndexNames(indexes) {
	const seen = new Map();
	for (const { n } of indexes) seen.set(n, (seen.get(n) || 0) + 1);
	const out = new Map();
	for (const { t, n } of indexes) out.set(`${t}.${n}`, fit63(seen.get(n) > 1 ? `${t}_${n}` : n));
	return out;
}

export const enumCheckName = (table, column) => fit63(`ck_${table}_${column}`);
export const pkName = (table) => fit63(`${table}_pkey`);

// Dependency order (parents first) from [{ t, rt }] foreign keys. Throws on cycles that cannot be ordered.
export function orderTables(tables, fks) {
	const deps = new Map(tables.map((t) => [t, new Set()]));
	for (const f of fks) if (f.t !== f.rt && deps.has(f.t) && deps.has(f.rt)) deps.get(f.t).add(f.rt);
	const order = [];
	const done = new Set();
	let progress = true;
	while (order.length < tables.length && progress) {
		progress = false;
		for (const t of [...tables].sort()) {
			if (done.has(t)) continue;
			if ([...deps.get(t)].every((d) => done.has(d))) {
				order.push(t);
				done.add(t);
				progress = true;
			}
		}
	}
	if (order.length < tables.length) {
		// Circular references are fine in PostgreSQL because foreign keys are added after the tables exist.
		for (const t of [...tables].sort()) if (!done.has(t)) order.push(t);
	}
	return order;
}
