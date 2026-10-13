// Creates and migrates the scratch test database. Refuses to run against anything but a local *_test DB.
import { execFileSync } from "child_process";
import dotenv from "dotenv";
import mysql from "mysql2/promise";

export default async function setup() {
  dotenv.config({ quiet: true } as never);
  const db = process.env.LT_TEST_DB || "sharpstudy_lt_test";
  const host = process.env.DB_HOSTNAME || "";
  if (!/^(127\.0\.0\.1|localhost)$/.test(host) || !db.endsWith("_test")) throw new Error(`Refusing to run integration tests against ${host}/${db}`);
  const c = await mysql.createConnection({ host, port: Number(process.env.DB_PORT || 3306), user: process.env.DB_USERNAME, password: process.env.DB_PASSWORD });
  // Fresh database every run so tests never depend on leftovers.
  await c.query(`DROP DATABASE IF EXISTS \`${db}\``);
  await c.query(`CREATE DATABASE \`${db}\``);
  await c.end();
  const run = (cmd: string) => execFileSync("npx", ["sequelize-cli", cmd], { env: { ...process.env, NODE_ENV: "development", DB_NAME_DEVELOPMENT: db }, stdio: "pipe" });
  // Up, down (Learn Together migration only), up again: proves the migration is reversible on a fresh DB.
  run("db:migrate");
  run("db:migrate:undo");
  run("db:migrate");
}
