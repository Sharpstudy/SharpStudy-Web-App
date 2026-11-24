// Loaded into the Phase 7 TEST servers with NODE_OPTIONS=--require (never into the normal application).
//
//  * nodemailer is replaced by a recorder: no SMTP connection is ever opened, no e-mail can be delivered. Every message that
//    the application tries to send is appended (recipient + subject only, no body) to E2E_MAIL_LOG.
//  * with E2E_MYSQL_READONLY=1 every MySQL connection is switched to READ ONLY by the server as soon as it is created, so
//    even a bug in a test cannot write to MySQL.
const Module = require("module");
const fs = require("fs");

const original = Module._load;
const mailLog = process.env.E2E_MAIL_LOG;

function fakeNodemailer(real) {
	const wrapped = Object.create(real);
	wrapped.createTransport = () => ({
		sendMail(opts, cb) {
			const line = JSON.stringify({ at: new Date().toISOString(), to: String(opts && opts.to), subject: String(opts && opts.subject) }) + "\n";
			if (mailLog) fs.appendFileSync(mailLog, line);
			const info = { messageId: "<test-mock@localhost>", accepted: [opts && opts.to], rejected: [] };
			if (typeof cb === "function") return cb(null, info);
			return Promise.resolve(info);
		},
		verify(cb) {
			if (typeof cb === "function") return cb(null, true);
			return Promise.resolve(true);
		},
		close() {},
	});
	return wrapped;
}

function readOnlyMysql(real) {
	const wrapped = Object.create(real);
	const guard = (conn) => {
		conn.query("SET SESSION TRANSACTION READ ONLY", () => {});
		return conn;
	};
	wrapped.createConnection = (...args) => guard(real.createConnection(...args));
	return wrapped;
}

// with E2E_PG_QUERY_LOG every statement sent to PostgreSQL appends one line to that file (a query counter for the performance comparison;
// nothing of the statement or its values is recorded)
const queryLog = process.env.E2E_PG_QUERY_LOG;
function countPgQueries(real) {
	if (!queryLog || real.__queriesCounted || !real.Client) return real;
	const originalQuery = real.Client.prototype.query;
	real.Client.prototype.query = function (...args) {
		fs.appendFileSync(queryLog, "Q\n");
		return originalQuery.apply(this, args);
	};
	real.__queriesCounted = true;
	return real;
}

Module._load = function (request, parent, isMain) {
	const loaded = original.apply(this, arguments);
	if (request === "pg") return countPgQueries(loaded);
	if (request === "nodemailer") return fakeNodemailer(loaded);
	if (process.env.E2E_MYSQL_READONLY === "1" && request === "mysql2") return readOnlyMysql(loaded);
	return loaded;
};

if (process.env.E2E_PRELOAD_BANNER !== "0") {
	console.log(`[test-preload] mail mock active${mailLog ? " (log: yes)" : ""}; MySQL read-only guard: ${process.env.E2E_MYSQL_READONLY === "1" ? "ACTIVE" : "off"}`);
}
