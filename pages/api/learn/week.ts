import { route, str, badRequest } from "@/learn-together/server/http";
import { getWeekPlan, saveWeekPlan } from "@/learn-together/server/weeklyPlan";
import { z } from "zod";

const itemSchema = z.object({
  subject: z.string().min(1).max(40),
  dayOfWeek: z.number().int().min(0).max(6),
  lessonSlug: z.string().max(80).nullable().optional(),
  position: z.number().int().min(0).optional(),
});

const saveSchema = z.object({
  childProfileId: z.string().uuid(),
  weekStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  items: z.array(itemSchema),
});

export default route({
  auth: "parent",
  handlers: {
    GET: async ({ req, parent }) => {
      const childProfileId = str(req.query.childProfileId);
      const weekStart = str(req.query.weekStart);
      if (!childProfileId || !weekStart) throw badRequest("childProfileId and weekStart required");
      return getWeekPlan(parent.familyId, childProfileId, weekStart);
    },
    POST: async ({ req, parent }) => {
      const body = saveSchema.parse(req.body);
      await saveWeekPlan(parent.familyId, body.childProfileId, body.weekStart, body.items);
      return { ok: true };
    },
  },
});
