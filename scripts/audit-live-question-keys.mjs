// READ-ONLY audit of saved live-question answer keys. It changes nothing.
//   node scripts/audit-live-question-keys.mjs
// Why: before the fix, the editor pre-selected the first answer and the server turned a missing
// key into option 1, so many keys were never chosen on purpose. This lists every published
// question with its saved key, how many questions share that default, and whether students'
// answers were graded against it, so an instructor can check each one and, where it is wrong,
// correct THAT question from the instructor panel ("Wrong answer marked? Fix it").
// Nothing is bulk-changed: only a person who knows the right answer should change a key.
import fs from "node:fs";
import mysql from "mysql2/promise";

for (const line of fs.readFileSync(new URL("../.env", import.meta.url), "utf8").split(/\r?\n/)) {
	const m = line.match(/^([A-Z_]+)=(.*)$/);
	if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, "");
}
const db = await mysql.createConnection({
	host: process.env.DB_HOSTNAME,
	port: process.env.DB_PORT,
	user: process.env.DB_USERNAME,
	password: process.env.DB_PASSWORD,
	database: process.env.DB_NAME_DEVELOPMENT,
});
const [rows] = await db.query(
	`SELECT q.id, q.question_text, q.options, q.correct_option_id, q.status, q.class_id,
	        (SELECT COUNT(*) FROM live_question_responses r WHERE r.live_question_id = q.id) AS responses,
	        (SELECT COUNT(*) FROM live_question_responses r WHERE r.live_question_id = q.id AND r.is_correct = 1) AS graded_correct
	   FROM live_questions q WHERE q.status <> 'draft' ORDER BY q.created_at`
);
let first = 0;
for (const r of rows) {
	const options = typeof r.options === "string" ? JSON.parse(r.options) : r.options;
	const key = options.find((o) => o.id === r.correct_option_id);
	if (r.correct_option_id === "o1") first++;
	console.log(`${r.id.slice(0, 8)}  [${r.status}]  "${r.question_text}"`);
	console.log(`          options: ${options.map((o) => `${o.id}=${o.text}`).join(" | ")}`);
	console.log(`          saved key: ${r.correct_option_id} (${key ? key.text : "MISSING!"})   responses: ${r.responses}, graded correct: ${r.graded_correct}${r.class_id ? "   session-linked" : ""}`);
}
console.log(`\n${rows.length} published question(s); ${first} have the first option saved as the key.`);
if (rows.length > 1 && first === rows.length) console.log("Every key is the first option - that is the old editor default, so please verify each one.");
await db.end();
