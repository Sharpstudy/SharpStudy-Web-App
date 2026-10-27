import { route, badRequest } from "@/learn-together/server/http";
import { getFamilyValues, saveFamilyValues } from "@/learn-together/server/blueprint";
import { z } from "zod";

const saveSchema = z.object({
  values: z.array(z.object({
    valueCategory: z.string().min(1).max(40),
    importance: z.number().int().min(1).max(5),
  })),
});

export default route({
  auth: "parent",
  handlers: {
    GET: async ({ parent }) => {
      return getFamilyValues(parent.familyId);
    },
    POST: async ({ req, parent }) => {
      const { values } = saveSchema.parse(req.body);
      await saveFamilyValues(parent.familyId, values);
      return { ok: true };
    },
  },
});
