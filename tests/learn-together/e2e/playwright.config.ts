import { defineConfig, devices } from "@playwright/test";

const PORT = 3105;
const env = {
  DB_NAME_DEVELOPMENT: "sharpstudy_lt_e2e",
  FEATURE_LEARN_TOGETHER: "true",
  BASE_URL: `http://localhost:${PORT}`,
  ABLY_API_KEY: "",
  LT_SEND_EMAIL: "false",
};

export default defineConfig({
  testDir: ".",
  testMatch: /.*\.spec\.ts/,
  fullyParallel: false,
  workers: 1,
  timeout: 180_000,
  expect: { timeout: 20_000 },
  reporter: [["list"]],
  use: { baseURL: `http://localhost:${PORT}`, trace: "retain-on-failure", ...devices["Desktop Chrome"] },
  webServer: {
    command: `node tests/learn-together/e2e/prepare-db.mjs && npx next dev -p ${PORT}`,
    cwd: "../../..",
    url: `http://localhost:${PORT}/learn/join/`,
    timeout: 240_000,
    reuseExistingServer: false,
    env,
  },
});
