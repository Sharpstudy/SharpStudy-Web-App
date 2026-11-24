import Sequelize from "sequelize";
import config from "./config/config.mjs";
import { uuidGuardHooks } from "../lib/db/uuidGuard.js";

// MySQL is the default. PostgreSQL is used only when DB_DIALECT=postgres is set explicitly.
const dialect = String(process.env.DB_DIALECT || "mysql").trim().toLowerCase();
if (dialect !== "mysql" && dialect !== "postgres") {
  throw new Error(`Unsupported DB_DIALECT "${dialect}". Use "mysql" (default) or "postgres".`);
}

const isProduction = process.env.NODE_ENV === "production";
const environment = (dialect === "postgres" ? "postgres_" : "") + (isProduction ? "production" : "development");

const settings = config[environment];
const options =
  dialect === "postgres"
    ? // A malformed id in a lookup must find nothing (as it did on MySQL) instead of raising a uuid syntax error.
      { ...settings, define: { ...(settings.define || {}), hooks: uuidGuardHooks } }
    : settings;

const connection = new Sequelize(options);

export default connection;
