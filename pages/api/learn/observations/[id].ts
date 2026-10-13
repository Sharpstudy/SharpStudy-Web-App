import { route, str } from "@/learn-together/server/http";
import { z } from "zod";
import { deleteObservation, editObservation } from "@/learn-together/server/progress";

export default route({
  auth: "parent",
  handlers: {
    PATCH: async ({ parent, req }) => {
      const body = z.object({ outcome: z.enum(["understood", "practice_again", "not_sure"]).optional(), parentNote: z.string().max(1000).nullable().optional() }).parse(req.body || {});
      await editObservation(parent, str(req.query.id), body);
      return { ok: true };
    },
    DELETE: async ({ parent, req }) => {
      await deleteObservation(parent, str(req.query.id));
      return { ok: true };
    },
  },
});
