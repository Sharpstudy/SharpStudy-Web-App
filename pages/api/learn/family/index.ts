import { route, badRequest } from "@/learn-together/server/http";
import { z } from "zod";
import { createFamily } from "@/learn-together/server/family";
import { Family } from "@/learn-together/server/models";
import { requireOwner } from "@/learn-together/server/auth";

const nameSchema = z.object({ name: z.string().trim().max(80).default("") });

export default route({
  auth: "user",
  handlers: {
    POST: async ({ parent, req }) => ({ familyId: await createFamily(parent, nameSchema.parse(req.body || {}).name) }),
    PATCH: async ({ parent, req }) => {
      if (!parent.familyId) throw badRequest("Set up your family first");
      requireOwner(parent);
      const { name } = nameSchema.parse(req.body || {});
      await Family.update({ name: name || "My family" }, { where: { id: parent.familyId } });
      return { ok: true };
    },
  },
});
