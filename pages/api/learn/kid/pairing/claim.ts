import { route } from "@/learn-together/server/http";
import { z } from "zod";
import { claimPairing } from "@/learn-together/server/pairing";
import { assertSameOrigin } from "@/learn-together/server/auth";

export default route({
  auth: "public",
  handlers: {
    POST: async ({ req, res }) => {
      assertSameOrigin(req);
      return claimPairing(req, res, z.object({ code: z.string() }).parse(req.body || {}).code);
    },
  },
});
