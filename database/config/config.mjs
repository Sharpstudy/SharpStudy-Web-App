import mysql2 from "mysql2";

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
};
