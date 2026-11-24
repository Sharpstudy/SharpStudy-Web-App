import mysql2 from "mysql2";
import pg from "pg";

// ---------------------------------------------------------------------------------------------
// Database configuration for Sequelize (application, sequelize-cli and migration tooling).
//
// Two dialects are supported. MySQL is the DEFAULT and is unchanged; PostgreSQL is opt-in:
//
//   DB_DIALECT=mysql      (default, also when unset)  -> "development" / "production"
//   DB_DIALECT=postgres                               -> "postgres_development" / "postgres_production"
//
// Switching back to MySQL is just removing DB_DIALECT (or setting it to mysql); nothing else changes.
//
// PostgreSQL credentials never live in tracked files:
//   PG_HOST      (default localhost)       PG_PORT      (default 5432)
//   PG_DATABASE  (default sharpstudy_dev, development only)
//   PG_USER      (default sharpstudy_dev, development only)
//   PG_PASSWORD  optional. When it is NOT set, the pg driver reads the password from the standard
//                PostgreSQL password file (Windows: %APPDATA%\postgresql\pgpass.conf, or PGPASSFILE).
//   Production (postgres_production) reads everything from the environment and requires TLS:
//   PG_HOST_PROD, PG_PORT_PROD, PG_DATABASE_PROD, PG_USER_PROD, PG_PASSWORD_PROD, PG_CA_CERT.
// ---------------------------------------------------------------------------------------------

// Pool size from the environment, accepted only as a whole number from 1 to 20; anything else falls back to the default.
const poolMax = (value, fallback) => {
  const n = Number(value);
  return Number.isInteger(n) && n >= 1 && n <= 20 ? n : fallback;
};

// Only include a password when one is really configured: an empty/undefined value must leave the field
// out so that the driver falls back to pgpass.conf.
const optionalPassword = (value) => (value ? { password: value } : {});

// Test runs use a throw-away schema (never "public") so that nothing they write can touch the real tables.
// Only a plain identifier is accepted, so the value can never inject anything into the connection options.
const testSearchPath = /^[a-z_][a-z0-9_]{0,62}$/.test(process.env.PG_SEARCH_PATH || "") ? { dialectOptions: { options: `-c search_path=${process.env.PG_SEARCH_PATH}` } } : {};

export default {
  development: {
    username: process.env.DB_USERNAME,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME_DEVELOPMENT,
    host: process.env.DB_HOSTNAME,
    port: process.env.DB_PORT,
    dialect: "mysql",
  },
  production: {
    username: process.env.DB_USERNAME,
    password: process.env.DB_PASSWORD_PROD,
    database: process.env.DB_NAME_PRODUCTION,
    host: process.env.DB_HOSTNAME,
    port: process.env.DB_PORT_PROD,
    logging: false,
    dialect: "mysql",
    // Explicit driver so the bundler keeps mysql2 in serverless builds
    dialectModule: mysql2,
    // Managed MySQL (Aiven) requires TLS; DB_CA_CERT holds the provider CA
    dialectOptions: {
      ssl: { ca: process.env.DB_CA_CERT, rejectUnauthorized: true },
    },
    // Each serverless instance opens its own pool, so keep it small
    pool: { max: 2, min: 0, idle: 10000, acquire: 30000 },
  },

  postgres_development: {
    dialect: "postgres",
    // sequelize-cli keeps the applied-migration list in this table (same name MySQL used)
    migrationStorageTableName: "sequelizemeta",
    host: process.env.PG_HOST || "localhost",
    port: Number(process.env.PG_PORT) || 5432,
    database: process.env.PG_DATABASE || "sharpstudy_dev",
    username: process.env.PG_USER || "sharpstudy_dev",
    ...optionalPassword(process.env.PG_PASSWORD),
    // Every session works in UTC; timestamps are stored as timestamptz.
    timezone: "+00:00",
    logging: false,
    pool: { max: 5, min: 0, idle: 10000, acquire: 30000 },
    ...testSearchPath,
  },
  postgres_production: {
    dialect: "postgres",
    // sequelize-cli keeps the applied-migration list in this table (same name MySQL used)
    migrationStorageTableName: "sequelizemeta",
    host: process.env.PG_HOST_PROD,
    port: Number(process.env.PG_PORT_PROD) || 5432,
    database: process.env.PG_DATABASE_PROD,
    username: process.env.PG_USER_PROD,
    ...optionalPassword(process.env.PG_PASSWORD_PROD),
    timezone: "+00:00",
    logging: false,
    // Explicit driver so the bundler keeps pg in serverless builds
    dialectModule: pg,
    // Managed PostgreSQL requires TLS; PG_CA_CERT holds the provider CA
    dialectOptions: {
      ssl: { ca: process.env.PG_CA_CERT, rejectUnauthorized: true },
    },
    // Each serverless instance opens its own pool, so the default stays small. A long-running server (container / VM) can raise it with
    // PG_POOL_MAX (1-20): keep instances x PG_POOL_MAX below PostgreSQL's max_connections (default 100) minus admin and migration sessions.
    pool: { max: poolMax(process.env.PG_POOL_MAX, 2), min: 0, idle: 10000, acquire: 30000 },
  },
};
