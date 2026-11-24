// PostgreSQL only. MySQL stored ids as CHAR(36), so a lookup with a malformed id ("abc", "undefined", "1") simply found
// nothing and the API answered 404. PostgreSQL stores real uuid values and REJECTS a malformed one with an error
// (22P02), which would turn those requests into 500s.
//
// This hook keeps the MySQL behaviour: inside a query's `where`, a malformed value for a UUID column is replaced by the nil
// UUID, which no row has, so the query returns no rows. It never widens a query: it only touches values that could not
// match anything. It is installed only when DB_DIALECT=postgres (database/connection.js).
import { Op } from "sequelize";

export const NIL_UUID = "00000000-0000-0000-0000-000000000000";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuidString = (v) => typeof v === "string" && UUID_RE.test(v);

const isUuidAttribute = (attr) => !!attr && !!attr.type && (attr.type.key === "UUID" || (attr.type.constructor && attr.type.constructor.key === "UUID"));

// Replaces malformed values (strings, or arrays / operator objects containing strings) and returns the new value.
function clean(value) {
	if (typeof value === "string") return isUuidString(value) ? value : NIL_UUID;
	if (Array.isArray(value)) return value.map(clean);
	if (value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
		const out = { ...value };
		for (const sym of Object.getOwnPropertySymbols(value)) {
			// equality / membership operators only; anything else (e.g. a literal or a function) is left as it is
			if ([Op.eq, Op.ne, Op.in, Op.notIn, Op.or, Op.and].includes(sym)) out[sym] = clean(value[sym]);
		}
		return out;
	}
	return value;
}

// where: { id: "abc", userId: [ ... ], [Op.or]: [ { id: "x" }, ... ] }   (top level and nested Op.and / Op.or only)
export function guardWhere(model, where) {
	if (!where || typeof where !== "object" || Array.isArray(where) || Object.getPrototypeOf(where) !== Object.prototype) return where;
	const attrs = (model && model.rawAttributes) || {};
	const out = { ...where };
	for (const key of Object.keys(where)) {
		if (isUuidAttribute(attrs[key])) out[key] = clean(where[key]);
	}
	for (const sym of [Op.and, Op.or]) {
		if (Array.isArray(where[sym])) out[sym] = where[sym].map((w) => guardWhere(model, w));
	}
	return out;
}

// Hook functions for Sequelize's `define.hooks`; `this` is the model, as Sequelize calls model hooks.
function hook(options) {
	if (options && options.where) options.where = guardWhere(this, options.where);
}
export const uuidGuardHooks = { beforeFind: hook, beforeCount: hook, beforeBulkUpdate: hook, beforeBulkDestroy: hook };
