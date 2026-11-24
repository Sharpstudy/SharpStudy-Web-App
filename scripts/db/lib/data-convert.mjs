// Pure value-conversion and comparison rules for the MySQL -> PostgreSQL DATA migration.
// No database access here, so every rule is unit-tested (tests/db/data-convert.test.mjs).
//
// MySQL values arrive from mysql2 configured with dateStrings + text protocol + raw JSON text:
//   DATETIME -> "YYYY-MM-DD HH:MM:SS[.fff]" (stored as UTC by the application), DATE -> "YYYY-MM-DD",
//   TINYINT -> number, FLOAT -> number, JSON -> raw JSON text (so SQL NULL and JSON null stay distinguishable),
//   BLOB -> Buffer, CHAR/VARCHAR/TEXT -> string.
// Nothing is guessed: a value that does not fit its PostgreSQL type raises a ConversionError (the migration stops).
import { createHash } from "node:crypto";

export class ConversionError extends Error {
	constructor(message) {
		super(message);
		this.name = "ConversionError";
	}
}

// PostgreSQL format_type() text -> the kind the rules below work with.
export function kindOfPgType(fmt) {
	const t = String(fmt).toLowerCase();
	if (t === "uuid") return "uuid";
	if (t === "boolean") return "boolean";
	if (t === "integer") return "integer";
	if (t === "smallint") return "smallint";
	if (t === "bigint") return "bigint";
	if (t === "real") return "real";
	if (t === "double precision") return "double";
	if (/^timestamp(\(\d\))? with time zone$/.test(t)) return "timestamptz";
	if (t === "date") return "date";
	if (t === "jsonb") return "jsonb";
	if (t === "bytea") return "bytea";
	if (t === "text" || t.startsWith("character varying")) return "text";
	if (t.startsWith("character(")) return "char";
	throw new ConversionError(`No data rule for PostgreSQL type "${fmt}"`);
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATETIME_RE = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})(\.\d{1,6})?$/;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

// MySQL value -> value to bind as a PostgreSQL parameter. `null` stays null; "" stays "".
export function toPgParam(kind, v) {
	if (v === null || v === undefined) return null;
	switch (kind) {
		case "uuid":
			if (typeof v !== "string" || !UUID_RE.test(v)) throw new ConversionError(`not a UUID: ${JSON.stringify(String(v)).slice(0, 60)}`);
			return v;
		case "boolean":
			if (v === 1 || v === true || v === "1") return true;
			if (v === 0 || v === false || v === "0") return false;
			throw new ConversionError(`not a boolean: ${String(v).slice(0, 20)}`);
		case "integer":
		case "smallint":
			if (!Number.isInteger(Number(v))) throw new ConversionError(`not an integer: ${String(v).slice(0, 20)}`);
			return Number(v);
		case "bigint":
			if (!/^-?\d+$/.test(String(v))) throw new ConversionError(`not an integer: ${String(v).slice(0, 20)}`);
			return String(v);
		case "real":
		case "double":
			if (!Number.isFinite(Number(v))) throw new ConversionError(`not a finite number: ${String(v).slice(0, 20)}`);
			return Number(v);
		case "timestamptz": {
			if (typeof v !== "string") throw new ConversionError(`datetime is not a string (is dateStrings on?): ${typeof v}`);
			const m = DATETIME_RE.exec(v);
			if (!m || Number(m[1]) < 1 || Number(m[2]) < 1 || Number(m[3]) < 1) throw new ConversionError(`not a valid datetime: ${v.slice(0, 30)}`);
			return `${v}+00`; // the application stores UTC; this is the same instant, never the server's local time
		}
		case "date": {
			const m = typeof v === "string" ? DATE_RE.exec(v) : null;
			if (!m || Number(m[1]) < 1 || Number(m[2]) < 1 || Number(m[3]) < 1) throw new ConversionError(`not a valid date: ${String(v).slice(0, 20)}`);
			return v; // plain date text: no time zone is involved
		}
		case "jsonb":
			if (typeof v !== "string") throw new ConversionError("JSON must arrive as text");
			try {
				JSON.parse(v);
			} catch {
				throw new ConversionError("invalid JSON text");
			}
			return v;
		case "bytea":
			if (!Buffer.isBuffer(v)) throw new ConversionError("binary value is not a Buffer");
			return v;
		case "text":
		case "char":
			if (typeof v !== "string") throw new ConversionError(`text value is a ${typeof v}`);
			if (v.includes("\u0000")) throw new ConversionError("text contains a NUL character");
			return v;
		default:
			throw new ConversionError(`unknown kind ${kind}`);
	}
}

export function stableStringify(v) {
	if (v === null || typeof v !== "object") return JSON.stringify(v);
	if (Array.isArray(v)) return "[" + v.map(stableStringify).join(",") + "]";
	return "{" + Object.keys(v).sort().map((k) => JSON.stringify(k) + ":" + stableStringify(v[k])).join(",") + "}";
}

// Canonical form of a value as read from MySQL (side "mysql") or PostgreSQL (side "pg"), so equal data compares equal
// and any real difference does not. Accounts for the legitimate representation differences (UUID case, JSON key order and
// spacing, binary, timestamps as UTC instants, FLOAT as 4-byte single precision, CHAR padding).
export function canon(kind, v, side) {
	if (v === null || v === undefined) return null;
	switch (kind) {
		case "uuid":
			return String(v).toLowerCase();
		case "boolean":
			return side === "mysql" ? v === 1 || v === true || v === "1" : v === true;
		case "integer":
		case "smallint":
			return Number(v);
		case "bigint":
			return String(v);
		case "real":
			return String(Math.fround(Number(v)));
		case "double":
			return String(Number(v));
		case "timestamptz": {
			const ms = side === "mysql" ? Date.parse(String(v).replace(" ", "T") + "Z") : v instanceof Date ? v.getTime() : Date.parse(v);
			return Number.isNaN(ms) ? "invalid" : ms;
		}
		case "date":
			return String(v).slice(0, 10);
		case "jsonb":
			// Both sides must hand over the JSON as RAW TEXT (MySQL: typeCast in openMysql; PostgreSQL: the column is selected
			// as ::text, see readPgTable). Parsing here is then unambiguous, also for scalar JSON such as "claude-opus-5-5" or null.
			return stableStringify(JSON.parse(v));
		case "bytea":
			return `${v.length}:${createHash("sha256").update(v).digest("hex")}`;
		case "char":
			return String(v).replace(/ +$/, "");
		default:
			return String(v);
	}
}

export const sha256 = (s) => createHash("sha256").update(s).digest("hex");

// Hash of one row: columns in schema order, each canonicalised.
export function rowHash(columns, kinds, row, side) {
	return sha256(JSON.stringify(columns.map((c, i) => canon(kinds[i], row[c], side))));
}

// Key of a row from its primary-key columns.
export function rowKey(pkColumns, columns, kinds, row, side) {
	return pkColumns.map((c) => String(canon(kinds[columns.indexOf(c)], row[c], side))).join("|");
}

// Order-independent checksum of a whole table from its row hashes.
export function tableChecksum(rowHashes) {
	return sha256([...rowHashes].sort().join("\n"));
}
