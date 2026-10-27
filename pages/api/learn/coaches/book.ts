import { route, badRequest } from "@/learn-together/server/http";
import { bookCoach } from "@/learn-together/server/coaches";
import { z } from "zod";

const schema = z.object({
  coachId: z.string().uuid(),
  scheduledAt: z.string().datetime(),
  durationMinutes: z.number().int().min(30).max(180).default(60),
  notes: z.string().max(500).optional(),
});

export default route({
  auth: "parent",
  handlers: {
    POST: async ({ req, parent }) => {
      const body = schema.parse(req.body);
      const booking = await bookCoach(
        body.coachId,
        parent.familyId,
        parent.userId,
        new Date(body.scheduledAt),
        body.durationMinutes,
        body.notes
      );
      return booking;
    },
  },
});
