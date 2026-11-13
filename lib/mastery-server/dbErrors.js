// Maps a database failure to a safe, helpful API answer. A missing table/column means a migration has not been
// applied to this database: that is a setup problem the operator can fix, so say so (503) instead of a blank
// "Something went wrong". The answer never contains SQL, table or column names, hosts or stack traces; the
// operator gets those from the server log line (code + table only).

const SCHEMA_CODES = new Set(["ER_NO_SUCH_TABLE", "ER_BAD_FIELD_ERROR", "ER_BAD_TABLE_ERROR"]);

const dbCode = (e) => (e && ((e.original && e.original.code) || (e.parent && e.parent.code) || e.code)) || null;

export function isSchemaMismatch(e) {
	return SCHEMA_CODES.has(dbCode(e));
}

// -> { status, body } or null when the error is not one we translate.
export function friendlyDbError(e) {
	if (isSchemaMismatch(e)) {
		return {
			status: 503,
			body: { code: "setup_incomplete", message: "This feature needs a database update that has not been applied yet. Ask an administrator to run the pending database migrations." },
		};
	}
	if (e && typeof e.name === "string" && e.name.startsWith("SequelizeConnection")) {
		return { status: 503, body: { code: "db_unavailable", message: "The service is temporarily unavailable. Please try again shortly." } };
	}
	return null;
}

// What goes to the server log: error code and the object it names, never the statement or its values.
export function logLine(e) {
	const m = e && (e.original && e.original.sqlMessage ? e.original.sqlMessage : e.message);
	const named = /Table '([^']+)'|Unknown column '([^']+)'/.exec(String(m || ""));
	return `${dbCode(e) || (e && e.name) || "error"}${named ? ` (${named[1] || named[2]})` : ""}`;
}
