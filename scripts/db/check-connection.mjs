// Read-only connection check for the configured dialect (MySQL by default, PostgreSQL with DB_DIALECT=postgres).
//   yarn db:check                      -> MySQL
//   DB_DIALECT=postgres yarn db:check  -> PostgreSQL (password from PG_PASSWORD or pgpass.conf)
// Runs SELECT statements only. Prints no credentials.
import connection from "../../database/connection.js";

const dialect = connection.getDialect();
const sql =
	dialect === "postgres"
		? "SELECT current_database() AS db, current_user AS usr, version() AS version, current_setting('TimeZone') AS session_tz"
		: "SELECT DATABASE() AS db, CURRENT_USER() AS usr, VERSION() AS version, @@session.time_zone AS session_tz";

try {
	const [rows] = await connection.query(sql);
	const r = rows[0];
	console.log(`dialect:        ${dialect}`);
	console.log(`database:       ${r.db}`);
	console.log(`user:           ${r.usr}`);
	console.log(`server version: ${String(r.version).split(",")[0]}`);
	console.log(`session tz:     ${r.session_tz}`);
	if (dialect === "postgres") console.log(`password source: ${process.env.PG_PASSWORD ? "PG_PASSWORD environment variable" : "pgpass.conf / PGPASSFILE"}`);
	process.exitCode = 0;
} catch (e) {
	console.error(`connection failed (${dialect}): ${e.name}: ${e.message}`);
	process.exitCode = 1;
} finally {
	await connection.close();
}
