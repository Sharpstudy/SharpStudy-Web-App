// Server-only feature flag. Default: on in local dev and Vercel preview, off in production.
export function isLearnTogetherEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const v = (env.FEATURE_LEARN_TOGETHER || "").toLowerCase();
  if (v === "true" || v === "1") return true;
  if (v === "false" || v === "0") return false;
  if (env.VERCEL_ENV === "production") return false;
  if (env.VERCEL_ENV === "preview") return true;
  return env.NODE_ENV !== "production";
}
