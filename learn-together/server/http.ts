import type { NextApiRequest, NextApiResponse } from "next";
import { ZodError } from "zod";
import { isLearnTogetherEnabled } from "./flag";
import { InvalidTransition } from "@/learn-together/domain/session";
import { requireParent, requireDevice, requireLtRole, type ParentPrincipal, type DevicePrincipal, type LtRole } from "./auth";

import { HttpError } from "./errors";
export { HttpError, notFound, forbidden, badRequest } from "./errors";

export interface Ctx {
  req: NextApiRequest;
  res: NextApiResponse;
  parent: ParentPrincipal;
  device: DevicePrincipal;
}

type Handler = (ctx: Ctx) => Promise<unknown>;
type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export interface RouteSpec {
  /** parent: signed-in user with a family; user: signed-in user (family optional); device: paired child device; public: no principal */
  auth: "parent" | "user" | "device" | "public";
  roles?: LtRole[];
  handlers: Partial<Record<Method, Handler>>;
}

export function route(spec: RouteSpec) {
  return async function handler(req: NextApiRequest, res: NextApiResponse) {
    res.setHeader("Cache-Control", "no-store");
    if (!isLearnTogetherEnabled()) return res.status(404).json({ message: "Not found" });
    const fn = spec.handlers[req.method as Method];
    if (!fn) {
      res.setHeader("Allow", Object.keys(spec.handlers).join(", "));
      return res.status(405).json({ message: `Method ${req.method} not allowed` });
    }
    try {
      const ctx = { req, res } as Ctx;
      if (spec.auth === "parent" || spec.auth === "user") {
        ctx.parent = await requireParent(req, { requireFamily: spec.auth === "parent" });
        if (spec.roles) requireLtRole(ctx.parent, spec.roles);
      } else if (spec.auth === "device") {
        ctx.device = await requireDevice(req, res);
      }
      const out = await fn(ctx);
      if (res.headersSent) return;
      if (out === undefined) return res.status(204).end();
      return res.status(200).json(out);
    } catch (e) {
      if (e instanceof HttpError) return res.status(e.status).json({ message: e.message, code: e.code, errors: (e as HttpError & { errors?: unknown }).errors });
      if (e instanceof ZodError) return res.status(422).json({ message: "Invalid input", issues: e.issues.map((i) => ({ path: i.path.join("."), message: i.message })) });
      if (e instanceof InvalidTransition) return res.status(409).json({ message: e.message });
      console.error("[learn-together]", req.method, req.url?.split("?")[0], e instanceof Error ? e.message : e);
      return res.status(500).json({ message: "Something went wrong" });
    }
  };
}

export const str = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || "";
