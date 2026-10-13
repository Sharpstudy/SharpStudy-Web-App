import { describe, expect, it } from "vitest";
import { isLearnTogetherEnabled } from "@/learn-together/server/flag";

describe("feature flag", () => {
  const env = (o: Record<string, string>) => o as unknown as NodeJS.ProcessEnv;
  it("defaults: on in dev and preview, off in production", () => {
    expect(isLearnTogetherEnabled(env({ NODE_ENV: "development" }))).toBe(true);
    expect(isLearnTogetherEnabled(env({ NODE_ENV: "production", VERCEL_ENV: "preview" }))).toBe(true);
    expect(isLearnTogetherEnabled(env({ NODE_ENV: "production", VERCEL_ENV: "production" }))).toBe(false);
    expect(isLearnTogetherEnabled(env({ NODE_ENV: "production" }))).toBe(false);
  });
  it("explicit setting wins", () => {
    expect(isLearnTogetherEnabled(env({ NODE_ENV: "production", VERCEL_ENV: "production", FEATURE_LEARN_TOGETHER: "true" }))).toBe(true);
    expect(isLearnTogetherEnabled(env({ NODE_ENV: "development", FEATURE_LEARN_TOGETHER: "false" }))).toBe(false);
  });
});
