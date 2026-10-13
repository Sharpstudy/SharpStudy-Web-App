import { QueryTypes } from "sequelize";
import { sequelize } from "./models";
import { HttpError } from "./errors";

/** Fixed-window limiter in MySQL (no Redis in this stack). Throws 429 when exceeded. */
export async function rateLimit(key: string, limit: number, windowSeconds: number) {
  const now = new Date();
  const cutoff = new Date(now.getTime() - windowSeconds * 1000);
  const k = key.slice(0, 191);
  await sequelize.query(
    `INSERT INTO lt_rate_limits (\`key\`, window_start, count) VALUES (?, ?, 1)
     ON DUPLICATE KEY UPDATE count = IF(window_start < ?, 1, count + 1), window_start = IF(window_start < ?, VALUES(window_start), window_start)`,
    { replacements: [k, now, cutoff, cutoff], type: QueryTypes.INSERT }
  );
  const rows = (await sequelize.query("SELECT count FROM lt_rate_limits WHERE `key` = ?", { replacements: [k], type: QueryTypes.SELECT })) as { count: number }[];
  if ((rows[0]?.count || 0) > limit) throw new HttpError(429, "Too many attempts. Please wait a little and try again.", "rate_limited");
}

export function clientIp(req: { headers: Record<string, string | string[] | undefined>; socket?: { remoteAddress?: string } }) {
  const fwd = req.headers["x-forwarded-for"];
  const first = (Array.isArray(fwd) ? fwd[0] : fwd || "").split(",")[0].trim();
  return first || req.socket?.remoteAddress || "unknown";
}
