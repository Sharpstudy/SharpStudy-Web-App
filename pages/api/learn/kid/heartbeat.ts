import { route } from "@/learn-together/server/http";
import { z } from "zod";
import { heartbeat } from "@/learn-together/server/sessions";

export default route({
  auth: "device",
  handlers: {
    POST: async ({ device, req }) => {
      const b = z.object({ groupId: z.string().uuid().nullable().optional(), ackSeq: z.number().int().min(0).optional() }).parse(req.body || {});
      return heartbeat(device, b.groupId || null, b.ackSeq);
    },
  },
});
