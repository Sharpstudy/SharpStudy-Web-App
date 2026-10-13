import { defineConfig } from "vitest/config";
import path from "path";

const r = (p: string) => path.resolve(__dirname, p);

export default defineConfig({
  resolve: {
    alias: [
      { find: /^@\/learn-together\/(.*)$/, replacement: r("learn-together/$1") },
      { find: /^@\/database\/(.*)$/, replacement: r("database/$1") },
      { find: /^@\/content\/(.*)$/, replacement: r("content/$1") },
      { find: /^@\/email-templates\/(.*)$/, replacement: r("email-templates/$1") },
    ],
  },
  test: {
    include: ["tests/learn-together/**/*.test.ts"],
    environment: "node",
    setupFiles: ["tests/learn-together/setup-env.ts"],
    globalSetup: ["tests/learn-together/global-setup.ts"],
    pool: "forks",
    poolOptions: { forks: { singleFork: true } },
    testTimeout: 30000,
    hookTimeout: 120000,
  },
});
