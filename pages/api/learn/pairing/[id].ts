import { route, str } from "@/learn-together/server/http";
import { z } from "zod";
import { approvePairing, denyPairing, getPairingStatus } from "@/learn-together/server/pairing";

export default route({
  auth: "parent",
  handlers: {
    GET: async ({ parent, req }) => getPairingStatus(parent.familyId, str(req.query.id)),
    POST: async ({ parent, req }) => {
      const body = z.object({ decision: z.enum(["approve", "deny"]), label: z.string().optional() }).parse(req.body || {});
      if (body.decision === "deny") {
        await denyPairing(parent, str(req.query.id));
        return { ok: true };
      }
      return approvePairing(parent, str(req.query.id), body.label || "");
    },
  },
});
