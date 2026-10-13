import { route, str } from "@/learn-together/server/http";
import { z } from "zod";
import { setPictureCode } from "@/learn-together/server/family";

export default route({
  auth: "parent",
  handlers: {
    PUT: async ({ parent, req }) => {
      const { code } = z.object({ code: z.array(z.string()).nullable() }).parse(req.body || {});
      await setPictureCode(parent, str(req.query.id), code);
      return { ok: true };
    },
  },
});
