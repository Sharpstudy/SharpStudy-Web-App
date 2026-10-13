import { route, str } from "@/learn-together/server/http";
import { z } from "zod";
import { setOverride } from "@/learn-together/server/progress";

export default route({
  auth: "parent",
  handlers: {
    PUT: async ({ parent, req }) => {
      const body = z.object({ conceptTag: z.string().min(1).max(80), status: z.enum(["introduced", "practicing", "confident"]).nullable() }).parse(req.body || {});
      await setOverride(parent, str(req.query.id), body.conceptTag, body.status);
      return { ok: true };
    },
  },
});
