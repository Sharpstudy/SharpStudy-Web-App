// Small, dependency-light helpers that keep the data-access code working on BOTH databases.
// MySQL is the default; PostgreSQL is used when DB_DIALECT=postgres (see database/connection.js).
//
// Every helper takes the Sequelize instance (or a dialect name) and returns exactly what the code did before
// when the dialect is MySQL, so existing behaviour is preserved.
import { Op } from "sequelize";

export const dialectOf = (sequelizeOrName) => {
	if (typeof sequelizeOrName === "string") return sequelizeOrName;
	if (sequelizeOrName && typeof sequelizeOrName.getDialect === "function") return sequelizeOrName.getDialect();
	return "mysql";
};
export const isPostgres = (sequelizeOrName) => dialectOf(sequelizeOrName) === "postgres";

// ---- text matching -------------------------------------------------------------------------------------------
// MySQL's default collation compares and LIKE-matches text case-insensitively; PostgreSQL does not. The searches the
// application offers ("type part of a name / e-mail") must keep ignoring case, so PostgreSQL uses ILIKE.
export const likeOp = (sequelizeOrName) => (isPostgres(sequelizeOrName) ? Op.iLike : Op.like);

// "column equals value, ignoring case" (e-mail addresses, coupon codes, meeting references).
//   MySQL:      { column: value }                  (unchanged; the column collation is case-insensitive)
//   PostgreSQL: lower(column) = lower(value)       (for users.email this matches the unique index uq_users_email_lower)
// The result can be used as `where` or as one element of `[Op.and]: [...]`.
//
// Only a real string is lower-cased. Anything else (undefined, null, a number, an object) is handed to Sequelize exactly as on MySQL:
// `undefined` makes Sequelize refuse the query ("WHERE parameter ... has invalid undefined value", the routes answer 400), `null`
// becomes IS NULL. Turning such a value into the text "undefined" would silently bypass that check (found in Phase 7: a GET without an
// e-mail created an empty subscription row on PostgreSQL).
//
// `model` (optional): pass the Sequelize model when the query joins other tables that have a column of the same name (e.g. `slug` on
// courses AND categories). The column is then written as "Model"."column"; without it PostgreSQL would reject the name as ambiguous.
export function ciEquals(sequelize, column, value, model) {
	if (!isPostgres(sequelize) || typeof value !== "string") return { [column]: value };
	const ref = model && model.name ? `${model.name}.${column}` : column;
	return sequelize.where(sequelize.fn("lower", sequelize.col(ref)), value.toLowerCase());
}

// E-mail addresses are stored trimmed and lower-case so that the two databases agree on what "the same address" means.
export const normalizeEmail = (value) => (typeof value === "string" ? value.trim().toLowerCase() : value);

// ---- SQL fragments -------------------------------------------------------------------------------------------
export const randomOrderSql = (sequelizeOrName) => (isPostgres(sequelizeOrName) ? "random()" : "rand()");
// "Now in UTC" as the database sees it. MySQL keeps UTC_TIMESTAMP(); PostgreSQL's CURRENT_TIMESTAMP is an absolute
// instant stored in a timestamptz column, which is the same moment.
export const utcNowSql = (sequelizeOrName) => (isPostgres(sequelizeOrName) ? "CURRENT_TIMESTAMP" : "UTC_TIMESTAMP()");

// ---- error classification ------------------------------------------------------------------------------------
const codes = (e) => [e && e.code, e && e.parent && e.parent.code, e && e.original && e.original.code, e && e.parent && e.parent.errno, e && e.original && e.original.errno].filter((x) => x !== undefined && x !== null);

// A unique-key violation, from either database (or already translated to a Sequelize error / an application error code).
export function isDuplicateError(e) {
	if (!e) return false;
	if (e.name === "SequelizeUniqueConstraintError") return true;
	return codes(e).some((c) => c === "ER_DUP_ENTRY" || c === 1062 || c === "23505");
}

// A failure that is safe to retry because the whole transaction was rolled back: deadlock or lock timeout.
//   MySQL 1213 deadlock, 1205 lock wait timeout   PostgreSQL 40P01 deadlock, 55P03 lock not available, 40001 serialization failure
export function isLockRetryError(e) {
	return codes(e).some((c) => c === 1213 || c === 1205 || c === "ER_LOCK_DEADLOCK" || c === "ER_LOCK_WAIT_TIMEOUT" || c === "40P01" || c === "55P03" || c === "40001");
}

// A table or column that does not exist: the database has not been migrated (MySQL ER_NO_SUCH_TABLE / ER_BAD_FIELD_ERROR /
// ER_BAD_TABLE_ERROR, PostgreSQL 42P01 undefined_table / 42703 undefined_column).
const SCHEMA_CODES = new Set(["ER_NO_SUCH_TABLE", "ER_BAD_FIELD_ERROR", "ER_BAD_TABLE_ERROR", "42P01", "42703"]);
export const isSchemaMismatchCode = (e) => codes(e).some((c) => SCHEMA_CODES.has(c));
export const isMissingTableError = (e) => codes(e).some((c) => c === "ER_NO_SUCH_TABLE" || c === "42P01");
