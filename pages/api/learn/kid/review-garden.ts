import { route, str, badRequest } from "@/learn-together/server/http";
import { getDueItems, recordReview } from "@/learn-together/server/reviewGarden";
import { z } from "zod";

const reviewSchema = z.object({
  itemId: z.string().uuid(),
  outcome: z.enum(["easy", "okay", "hard"]),
});

export default route({
  auth: "device",
  handlers: {
    GET: async ({ req, device }) => {
      const childProfileId = str(req.query.childProfileId);
      if (!childProfileId) throw badRequest("childProfileId required");
      if (!device.childProfileIds.includes(childProfileId)) throw badRequest("Not authorised for this child");
      return getDueItems(childProfileId, new Date());
    },
    POST: async ({ req }) => {
      const body = reviewSchema.parse(req.body);
      return recordReview(body.itemId, body.outcome);
    },
  },
});
