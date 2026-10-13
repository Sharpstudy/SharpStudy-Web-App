// Fresh local e2e database: migrate, seed drafts (+ dev-publish the two appendix activities), create users.
// Refuses to run against anything except a local *_e2e database.
import { execFileSync } from "child_process";
import dotenv from "dotenv";
import mysql from "mysql2/promise";
import bcrypt from "bcrypt";
import { randomUUID } from "crypto";

dotenv.config({ quiet: true });
const db = process.env.DB_NAME_DEVELOPMENT;
const host = process.env.DB_HOSTNAME || "";
if (!/^(127\.0\.0\.1|localhost)$/.test(host) || !db || !db.endsWith("_e2e")) throw new Error(`Refusing to prepare ${host}/${db}`);

const c = await mysql.createConnection({ host, port: Number(process.env.DB_PORT || 3306), user: process.env.DB_USERNAME, password: process.env.DB_PASSWORD });
await c.query(`DROP DATABASE IF EXISTS \`${db}\``);
await c.query(`CREATE DATABASE \`${db}\``);
await c.query(`USE \`${db}\``);
const env = { ...process.env, NODE_ENV: "development" };
execFileSync("npx", ["sequelize-cli", "db:migrate"], { env, stdio: "pipe" });
execFileSync("npx", ["vite-node", "--config", "vitest.config.mts", "learn-together/scripts/seed.ts"], { env: { ...env, LT_DEV_PUBLISH_APPENDIX: "true" }, stdio: "pipe" });

const hash = await bcrypt.hash("password123", 8);
for (const [email, role, first] of [["parent@lt-e2e.test", "student", "Pat"], ["admin@lt-e2e.test", "admin", "Ada"]]) {
  await c.query("INSERT INTO users (id, first_name, last_name, email, password, role, email_confirmed, status, created_at, updated_at) VALUES (?, ?, 'Tester', ?, ?, ?, 1, 1, NOW(), NOW())", [randomUUID(), first, email, hash, role]);
}
await c.end();
console.log(`[e2e] prepared ${db}`);
