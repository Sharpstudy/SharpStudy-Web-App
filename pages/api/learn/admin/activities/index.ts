import { route } from "@/learn-together/server/http";
import { z } from "zod";
import { adminList, saveDraft } from "@/learn-together/server/content";
import { requireLtRole } from "@/learn-together/server/auth";

export default route({
  auth: "user",
  roles: ["lt_editor", "lt_reviewer"],
  handlers: {
    GET: async () => ({ activities: await adminList() }),
    POST: async ({ parent, req }) => {
      requireLtRole(parent, ["lt_editor"]);
      const body = z.object({ content: z.unknown(), tier: z.enum(["free", "paid"]).optional() }).parse(req.body || {});
      return saveDraft(parent.userId, body.content, { tier: body.tier });
    },
  },
});
