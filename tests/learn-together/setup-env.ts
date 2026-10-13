// Runs before every test file: point the app at the scratch test database, never anything else.
import dotenv from "dotenv";
dotenv.config({ quiet: true } as never);
process.env.DB_NAME_DEVELOPMENT = process.env.LT_TEST_DB || "sharpstudy_lt_test";
process.env.FEATURE_LEARN_TOGETHER = "true";
delete process.env.ABLY_API_KEY;
delete process.env.LT_SEND_EMAIL;
if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test-secret";
