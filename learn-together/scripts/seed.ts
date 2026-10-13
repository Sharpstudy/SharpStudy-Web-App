// Imports content/learn-together/*.json into lt_activity_versions as DRAFTS.
// With LT_DEV_PUBLISH_APPENDIX=true on a local database only, also publishes the two PRD appendix
// activities (bypassing review) so the flow can be tested. Never run against production.
import fs from "fs";
import path from "path";
import dotenv from "dotenv";

dotenv.config({ quiet: true } as never);

const APPENDIX = ["snack-budget", "paper-shape-coin-lab"];

async function main() {
  const host = process.env.DB_HOSTNAME || "";
  const isLocal = /^(127\.0\.0\.1|localhost)$/.test(host);
  if (process.env.NODE_ENV === "production" || process.env.VERCEL_ENV === "production") throw new Error("Refusing to seed in production");
  if (!isLocal && process.env.LT_ALLOW_REMOTE_DEV_SEED !== "true") throw new Error(`Refusing to seed non-local DB host ${host}. Set LT_ALLOW_REMOTE_DEV_SEED=true for a dev/preview database.`);

  const { saveDraft } = await import("../server/content");
  const { Activity, ActivityVersion, sequelize } = await import("../server/models");
  const { audit } = await import("../server/audit");
  (sequelize as unknown as { options: { logging: boolean } }).options.logging = false;

  const dir = path.resolve(process.cwd(), "content/learn-together");
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json"));
  for (const f of files) {
    const content = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
    const existing = await Activity.findOne({ where: { slug: content.slug } });
    const latest = existing && (await ActivityVersion.findOne({ where: { activityId: existing.id }, order: [["version", "DESC"]] }));
    if (latest && JSON.stringify(latest.content) === JSON.stringify(content)) {
      console.log(`= ${content.slug} v${latest.version} unchanged`);
      continue;
    }
    const r = await saveDraft(null, content);
    console.log(`+ ${content.slug} v${r.version} draft`);
  }

  if (process.env.LT_DEV_PUBLISH_APPENDIX === "true") {
    if (!isLocal) throw new Error("LT_DEV_PUBLISH_APPENDIX only works against a local database");
    for (const slug of APPENDIX) {
      const a = await Activity.findOne({ where: { slug } });
      const v = a && (await ActivityVersion.findOne({ where: { activityId: a.id }, order: [["version", "DESC"]] }));
      if (!a || !v) continue;
      await v.update({ reviewState: "published", publishedAt: v.publishedAt || new Date() });
      await a.update({ currentPublishedVersionId: v.id, status: "published" });
      await audit({ type: "system" }, "content.dev_published", "lt_activity", a.id, null, { versionId: v.id });
      console.log(`! ${slug} v${v.version} published for LOCAL DEV ONLY (reviews pending)`);
    }
  }
  await sequelize.close();
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
