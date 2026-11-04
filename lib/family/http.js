// Shared plumbing for /api/family/*: request context and the device-token headers.
import { clientIp } from "@/lib/mastery-server/http";
import familyRepo from "./repo";

export { familyRepo };

export const ctxOf = (req) => ({ ip: clientIp(req), userAgent: String(req.headers["user-agent"] || "").slice(0, 300) });

// Child devices authenticate with their own secret, never with an account cookie.
export const deviceToken = (req) => String(req.headers["x-device-token"] || "");
export const grownupToken = (req) => String(req.headers["x-grownup-token"] || "");
