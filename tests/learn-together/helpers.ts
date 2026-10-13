// Integration helpers: real API route handlers against the scratch DB, with minimal req/res mocks.
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { v4 as uuid } from "uuid";
import type { NextApiRequest, NextApiResponse } from "next";
import connection from "@/database/connection";
import { raw } from "./content";

(connection as unknown as { options: { logging: boolean } }).options.logging = false;

export interface CallResult {
  status: number;
  body: any;
  cookies: Record<string, string>;
  headers: Record<string, unknown>;
}

export interface CallOpts {
  method?: string;
  query?: Record<string, string>;
  body?: unknown;
  token?: string;
  cookies?: Record<string, string>;
  headers?: Record<string, string>;
}

export async function call(handler: (req: NextApiRequest, res: NextApiResponse) => unknown, o: CallOpts = {}): Promise<CallResult> {
  const headers: Record<string, string> = { host: "localhost:3005", "user-agent": "Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)", ...(o.headers || {}) };
  if (o.token) headers.authorization = o.token;
  if (o.cookies && Object.keys(o.cookies).length) headers.cookie = Object.entries(o.cookies).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("; ");
  const req = { method: o.method || "GET", query: o.query || {}, body: o.body, headers, url: "/api/test", socket: { remoteAddress: "127.0.0.1" } } as unknown as NextApiRequest;
  const out: CallResult = { status: 200, body: undefined, cookies: {}, headers: {} };
  let done = false;
  const res: any = {
    headersSent: false,
    setHeader(k: string, v: unknown) {
      out.headers[k.toLowerCase()] = v;
      return res;
    },
    getHeader(k: string) {
      return out.headers[k.toLowerCase()];
    },
    status(code: number) {
      out.status = code;
      return res;
    },
    json(b: unknown) {
      out.body = b;
      done = true;
      res.headersSent = true;
      return res;
    },
    send(b: unknown) {
      out.body = b;
      done = true;
      res.headersSent = true;
      return res;
    },
    end() {
      done = true;
      res.headersSent = true;
      return res;
    },
  };
  await handler(req, res);
  if (!done) throw new Error("handler did not respond");
  const sc = out.headers["set-cookie"];
  for (const c of (Array.isArray(sc) ? sc : sc ? [sc] : []) as string[]) {
    const [kv] = c.split(";");
    const [k, ...v] = kv.split("=");
    out.cookies[k] = decodeURIComponent(v.join("="));
  }
  return out;
}

export async function makeUser(opts: { role?: string; password?: string } = {}) {
  const id = uuid();
  const email = `lt-${id.slice(0, 8)}@sharpstudy.test`;
  await connection.query(
    "INSERT INTO users (id, first_name, last_name, email, password, role, email_confirmed, status, created_at, updated_at) VALUES (?, 'Pat', 'Parent', ?, ?, ?, 1, 1, NOW(), NOW())",
    { replacements: [id, email, await bcrypt.hash(opts.password || "password123", 4), opts.role || "student"] }
  );
  const token = jwt.sign({ userId: id, email }, process.env.JWT_SECRET as string, { expiresIn: "1h" });
  return { id, email, token };
}

const h = (p: string) => import(`../../pages/api/learn/${p}`).then((m) => m.default);
export const api = {
  me: () => h("me"),
  family: () => h("family/index"),
  pin: () => h("family/pin"),
  reauth: () => h("reauth"),
  children: () => h("children/index"),
  child: () => h("children/[id]/index"),
  progress: () => h("children/[id]/progress"),
  exportChild: () => h("children/[id]/export"),
  concepts: () => h("children/[id]/concepts"),
  observation: () => h("observations/[id]"),
  devices: () => h("devices/index"),
  device: () => h("devices/[id]"),
  pairing: () => h("pairing/index"),
  pairingOne: () => h("pairing/[id]"),
  activities: () => h("activities/index"),
  activity: () => h("activities/[slug]/index"),
  activityOp: () => h("activities/[slug]/[op]"),
  home: () => h("home"),
  groups: () => h("groups/index"),
  group: () => h("groups/[id]/index"),
  groupOp: () => h("groups/[id]/[op]"),
  privacyExport: () => h("privacy/export"),
  privacyDelete: () => h("privacy/delete"),
  adminActivities: () => h("admin/activities/index"),
  adminActivity: () => h("admin/activities/[id]"),
  adminMetrics: () => h("admin/metrics"),
  kidClaim: () => h("kid/pairing/claim"),
  kidStatus: () => h("kid/pairing/status"),
  kidMe: () => h("kid/me"),
  kidGroup: () => h("kid/groups/[id]/index"),
  kidGroupOp: () => h("kid/groups/[id]/[op]"),
  kidHeartbeat: () => h("kid/heartbeat"),
  kidExit: () => h("kid/exit"),
  kidSelect: () => h("kid/select-child"),
};

/** A parent with a family, a PIN and one or more children. */
export async function makeFamily(childNames: string[] = ["Maya"]) {
  const user = await makeUser();
  await call(await api.family(), { method: "POST", token: user.token, body: { name: "Test family" } });
  await call(await api.pin(), { method: "POST", token: user.token, body: { pin: "1234" } });
  const children: { id: string; nickname: string }[] = [];
  for (const n of childNames) {
    const r = await call(await api.children(), { method: "POST", token: user.token, body: { nickname: n, avatarKey: "fox", ageBand: "7-8" } });
    if (r.status !== 200) throw new Error(JSON.stringify(r.body));
    children.push(r.body.child);
  }
  return { user, children };
}

/** Pairs a new device to the given children; returns its device cookie. */
export async function pairDevice(token: string, childIds: string[], label = "Test iPad") {
  const start = await call(await api.pairing(), { method: "POST", token, body: { childProfileIds: childIds } });
  const claim = await call(await api.kidClaim(), { method: "POST", body: { code: start.body.code.toLowerCase() } });
  if (claim.status !== 200) throw new Error(JSON.stringify(claim.body));
  const ok = await call(await api.pairingOne(), { method: "POST", token, query: { id: start.body.requestId }, body: { decision: "approve", label } });
  if (ok.status !== 200) throw new Error(JSON.stringify(ok.body));
  const status = await call(await api.kidStatus(), { cookies: { lt_claim: claim.cookies.lt_claim } });
  return { cookies: { lt_device: status.cookies.lt_device }, deviceId: ok.body.deviceId as string, status: status.body.status as string };
}

let editor: Awaited<ReturnType<typeof makeUser>> | null = null;
let reviewer: Awaited<ReturnType<typeof makeUser>> | null = null;

/** Publishes an activity through the real review workflow (editor + separate reviewer). */
export async function publishActivity(slug: string, mutate?: (c: any) => void) {
  const { RoleAssignment } = await import("@/learn-together/server/models");
  if (!editor) {
    editor = await makeUser();
    reviewer = await makeUser();
    await RoleAssignment.create({ userId: editor.id, role: "lt_editor" });
    await RoleAssignment.create({ userId: reviewer!.id, role: "lt_reviewer" });
  }
  const content = raw(slug);
  if (mutate) mutate(content);
  const saved = await call(await api.adminActivities(), { method: "POST", token: editor.token, body: { content } });
  if (saved.status !== 200) throw new Error(JSON.stringify(saved.body));
  const { activityId, versionId } = saved.body;
  const op = async (token: string, body: unknown) => call(await api.adminActivity(), { method: "POST", token, query: { id: activityId }, body });
  await op(editor.token, { op: "request_reviews", versionId });
  for (const t of ["subject", "developmental", "accessibility", "editorial", "safety"]) await op(reviewer!.token, { op: "review", versionId, reviewType: t, decision: "approved" });
  const pub = await op(editor.token, { op: "publish", versionId });
  if (pub.status !== 200) throw new Error(JSON.stringify(pub.body));
  const { invalidateCatalog } = await import("@/learn-together/server/content");
  invalidateCatalog();
  return { activityId, versionId, editor, reviewer: reviewer! };
}

export async function reauthToken(token: string) {
  const r = await call(await api.reauth(), { method: "POST", token, body: { password: "password123" } });
  return r.body.reauthToken as string;
}
