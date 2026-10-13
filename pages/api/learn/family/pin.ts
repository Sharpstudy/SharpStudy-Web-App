import { route } from "@/learn-together/server/http";
import { z } from "zod";
import { setFamilyPin } from "@/learn-together/server/family";
import { requireReauth } from "@/learn-together/server/auth";

export default route({
  auth: "parent",
  handlers: {
    POST: async ({ parent, req }) => {
      const { pin } = z.object({ pin: z.string() }).parse(req.body || {});
      let reauthed = false;
      try {
        requireReauth(req, parent);
        reauthed = true;
      } catch {
        reauthed = false;
      }
      await setFamilyPin(parent, pin, { reauthed });
      return { ok: true };
    },
  },
});
