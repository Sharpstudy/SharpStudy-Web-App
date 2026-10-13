// Aggregated product metrics for the admin dashboard. Any cell backed by fewer than
// MIN_FAMILIES distinct families is suppressed (returned as null with suppressed: true).
import { QueryTypes } from "sequelize";
import { sequelize } from "./models";

export const MIN_FAMILIES = 5;
const q = <T,>(sql: string, replacements: unknown[] = []) => sequelize.query(sql, { replacements, type: QueryTypes.SELECT }) as Promise<T[]>;
const cell = (value: number | null, families: number) => (families < MIN_FAMILIES ? { value: null, families, suppressed: true } : { value, families, suppressed: false });
const ratio = (a: number, b: number) => (b ? Math.round((a / b) * 1000) / 10 : null);

function percentile(sorted: number[], p: number) {
  if (!sorted.length) return null;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[i];
}

export async function dashboard(days = 56) {
  const since = new Date(Date.now() - days * 86400000);

  const weekly = await q<{ wk: string; families: number; completed: number }>(
    `SELECT DATE_FORMAT(DATE_SUB(DATE(g.started_at), INTERVAL WEEKDAY(g.started_at) DAY), '%Y-%m-%d') AS wk,
            COUNT(DISTINCT g.family_id) AS families,
            COUNT(DISTINCT CASE WHEN s.status = 'completed' THEN g.id END) AS completed
     FROM lt_session_groups g JOIN lt_sessions s ON s.group_id = g.id
     WHERE g.started_at >= ? GROUP BY wk ORDER BY wk`,
    [since]
  );
  const northStar = weekly.map((w) => ({ week: w.wk, ...cell(w.families ? Math.round((Number(w.completed) / Number(w.families)) * 100) / 100 : null, Number(w.families)) }));

  const [act] = await q<{ families: number; activated: number }>(
    `SELECT COUNT(*) AS families,
            SUM(EXISTS (SELECT 1 FROM lt_session_groups g JOIN lt_sessions s ON s.group_id = g.id
                        WHERE g.family_id = f.id AND s.status = 'completed' AND s.completed_at <= DATE_ADD(f.created_at, INTERVAL 7 DAY))) AS activated
     FROM lt_families f WHERE f.created_at >= ?`,
    [since]
  );
  const activation = cell(ratio(Number(act.activated || 0), Number(act.families)), Number(act.families));

  const [comp] = await q<{ families: number; completed: number; ended: number }>(
    `SELECT COUNT(DISTINCT g.family_id) AS families, SUM(s.status = 'completed') AS completed, SUM(s.status IN ('completed','abandoned')) AS ended
     FROM lt_sessions s JOIN lt_session_groups g ON g.id = s.group_id WHERE s.started_at >= ?`,
    [since]
  );
  const completionRate = cell(ratio(Number(comp.completed || 0), Number(comp.ended || 0)), Number(comp.families));

  const famSessions = await q<{ family_id: string; t: Date }>(
    `SELECT g.family_id, MIN(s.completed_at) AS t FROM lt_sessions s JOIN lt_session_groups g ON g.id = s.group_id
     WHERE s.status = 'completed' GROUP BY g.family_id, g.id ORDER BY g.family_id, t`
  );
  const byFam = new Map<string, number[]>();
  for (const r of famSessions) byFam.set(r.family_id, [...(byFam.get(r.family_id) || []), new Date(r.t).getTime()]);
  let second = 0, third = 0;
  for (const ts of byFam.values()) {
    if (ts[1] !== undefined && ts[1] - ts[0] <= 14 * 86400000) second++;
    if (ts[2] !== undefined && ts[2] - ts[0] <= 30 * 86400000) third++;
  }
  const repeatUse = { second14d: cell(ratio(second, byFam.size), byFam.size), third30d: cell(ratio(third, byFam.size), byFam.size) };

  const [conn] = await q<{ families: number; total: number; connected: number }>(
    `SELECT COUNT(DISTINCT g.family_id) AS families, COUNT(*) AS total, SUM(p.child_device_id IS NOT NULL AND p.joined_at IS NOT NULL) AS connected
     FROM lt_session_participants p JOIN lt_session_groups g ON g.id = p.group_id WHERE g.started_at >= ?`,
    [since]
  );
  const connectedAdoption = cell(ratio(Number(conn.connected || 0), Number(conn.total)), Number(conn.families));

  const [pair] = await q<{ families: number; started: number; paired: number }>(
    `SELECT COUNT(DISTINCT family_id) AS families, COUNT(*) AS started, SUM(delivered_at IS NOT NULL) AS paired FROM lt_pairing_requests WHERE created_at >= ?`,
    [since]
  );
  const pairingSuccess = cell(ratio(Number(pair.paired || 0), Number(pair.started)), Number(pair.families));

  const lat = async (name: string) => {
    const rows = await q<{ v: number; fk: string }>(
      `SELECT CAST(JSON_EXTRACT(props, '$.latencyMs') AS SIGNED) AS v, family_key AS fk FROM lt_analytics_events WHERE name = ? AND at >= ? AND JSON_EXTRACT(props, '$.latencyMs') IS NOT NULL`,
      [name, since]
    );
    const vals = rows.map((r) => Number(r.v)).filter((n) => Number.isFinite(n) && n >= 0).sort((a, b) => a - b);
    const fams = new Set(rows.map((r) => r.fk)).size;
    return { p50: cell(percentile(vals, 50), fams), p95: cell(percentile(vals, 95), fams), samples: vals.length };
  };
  const countEv = async (name: string) => {
    const [r] = await q<{ n: number; fams: number }>(`SELECT COUNT(*) AS n, COUNT(DISTINCT family_key) AS fams FROM lt_analytics_events WHERE name = ? AND at >= ?`, [name, since]);
    return cell(Number(r.n), Number(r.fams));
  };
  const syncHealth = {
    launch: await lat("lt_launch_received"),
    step: await lat("lt_step_sync"),
    reconnects: await countEv("lt_realtime_reconnect"),
    failedLaunches: await countEv("lt_launch_failed"),
  };

  const funnel = await q<{ activity_id: string; slug: string; families: number; launched: number; completed: number; abandoned: number }>(
    `SELECT a.id AS activity_id, a.slug, COUNT(DISTINCT g.family_id) AS families, COUNT(s.id) AS launched,
            SUM(s.status = 'completed') AS completed, SUM(s.status = 'abandoned') AS abandoned
     FROM lt_sessions s JOIN lt_session_groups g ON g.id = s.group_id JOIN lt_activity_versions v ON v.id = g.activity_version_id
     JOIN lt_activities a ON a.id = v.activity_id WHERE s.started_at >= ? GROUP BY a.id, a.slug ORDER BY launched DESC`,
    [since]
  );
  const drop = await q<{ activity_id: string; max_step_index: number; n: number }>(
    `SELECT v.activity_id, g.max_step_index, COUNT(*) AS n FROM lt_sessions s JOIN lt_session_groups g ON g.id = s.group_id
     JOIN lt_activity_versions v ON v.id = g.activity_version_id WHERE s.status = 'abandoned' AND s.started_at >= ?
     GROUP BY v.activity_id, g.max_step_index`,
    [since]
  );
  const fb = await q<{ activity_id: string; kind: string; n: number; avg_rating: number | null }>(
    `SELECT v.activity_id, f.kind, COUNT(*) AS n, AVG(f.rating) AS avg_rating FROM lt_feedback f JOIN lt_activity_versions v ON v.id = f.activity_version_id
     WHERE f.created_at >= ? GROUP BY v.activity_id, f.kind`,
    [since]
  );
  const kits = await q<{ activity_id: string; n: number; users: number }>(
    `SELECT activity_id, COUNT(*) AS n, COUNT(DISTINCT user_id) AS users FROM lt_kit_interest WHERE at >= ? GROUP BY activity_id`,
    [since]
  );
  const perActivity = funnel.map((f) => {
    const fams = Number(f.families);
    const drops = drop.filter((d) => d.activity_id === f.activity_id).sort((a, b) => Number(b.n) - Number(a.n));
    const fbFor = (k: string) => fb.find((x) => x.activity_id === f.activity_id && x.kind === k);
    const kit = kits.find((k) => k.activity_id === f.activity_id);
    return {
      slug: f.slug,
      families: fams,
      launched: cell(Number(f.launched), fams),
      completionRate: cell(ratio(Number(f.completed || 0), Number(f.completed || 0) + Number(f.abandoned || 0)), fams),
      commonDropOffStepIndex: cell(drops[0] ? Number(drops[0].max_step_index) : null, fams),
      usefulness: cell(fbFor("usefulness_rating")?.avg_rating ? Math.round(Number(fbFor("usefulness_rating")!.avg_rating) * 10) / 10 : null, fams),
      confusionReports: cell(Number(fbFor("confusion")?.n || 0), fams),
      safetyReports: cell(Number(fbFor("safety_concern")?.n || 0), fams),
      kitInterest: cell(Number(kit?.n || 0), fams),
    };
  });

  const [conf] = await q<{ avg: number | null; fams: number }>(
    `SELECT AVG(c.rating) AS avg, COUNT(DISTINCT g.family_id) AS fams FROM lt_parent_confidence c JOIN lt_sessions s ON s.id = c.session_id
     JOIN lt_session_groups g ON g.id = s.group_id WHERE c.created_at >= ?`,
    [since]
  );
  const parentConfidence = cell(conf.avg === null ? null : Math.round(Number(conf.avg) * 10) / 10, Number(conf.fams));

  const moves = await q<{ fromStatus: string | null; toStatus: string; n: number; fams: number }>(
    `SELECT JSON_UNQUOTE(JSON_EXTRACT(props, '$.fromStatus')) AS fromStatus, JSON_UNQUOTE(JSON_EXTRACT(props, '$.toStatus')) AS toStatus,
            COUNT(*) AS n, COUNT(DISTINCT family_key) AS fams
     FROM lt_analytics_events WHERE name = 'lt_concept_status_changed' AND at >= ? GROUP BY fromStatus, toStatus`,
    [since]
  );
  const conceptMovement = moves.map((m) => ({ from: m.fromStatus === "null" ? null : m.fromStatus, to: m.toStatus, ...cell(Number(m.n), Number(m.fams)) }));

  const devices = await q<{ device_class: string | null; n: number; fams: number }>(
    `SELECT device_class, COUNT(*) AS n, COUNT(DISTINCT family_key) AS fams FROM lt_analytics_events WHERE at >= ? AND device_class IS NOT NULL GROUP BY device_class`,
    [since]
  );
  const deviceMix = devices.map((d) => ({ deviceClass: d.device_class, ...cell(Number(d.n), Number(d.fams)) }));

  return { since, minFamilies: MIN_FAMILIES, northStar, activation, completionRate, repeatUse, connectedAdoption, pairingSuccess, syncHealth, perActivity, parentConfidence, conceptMovement, deviceMix };
}
