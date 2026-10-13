import { z } from "zod";
import { route } from "@/learn-together/server/http";
import { verifyFamilyPin } from "@/learn-together/server/family";
import { HttpError } from "@/learn-together/server/errors";

// Single-device mode: leaving child mode on the parent's own device also needs the family PIN.
export default route({
  auth: "parent",
  handlers: {
    POST: async ({ parent, req }) => {
      const { pin } = z.object({ pin: z.string().max(6) }).parse(req.body || {});
      if (!(await verifyFamilyPin(parent.familyId, pin))) throw new HttpError(401, "That PIN isn't right", "bad_pin");
      return { ok: true };
    },
  },
});
