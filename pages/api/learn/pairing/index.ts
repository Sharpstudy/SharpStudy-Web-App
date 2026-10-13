import { route } from "@/learn-together/server/http";
import { z } from "zod";
import { pendingApprovals, startPairing } from "@/learn-together/server/pairing";

export default route({
  auth: "parent",
  handlers: {
    GET: async ({ parent }) => ({ pending: await pendingApprovals(parent.familyId) }),
    POST: async ({ parent, req }) => startPairing(parent, z.object({ childProfileIds: z.array(z.string()) }).parse(req.body || {}).childProfileIds),
  },
});
