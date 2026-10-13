import { route, str } from "@/learn-together/server/http";
import { z } from "zod";
import { childHelp, childJoin, childReady, childRespond } from "@/learn-together/server/sessions";
import { HttpError } from "@/learn-together/server/errors";

const child = z.object({ childProfileId: z.string().uuid() });

export default route({
  auth: "device",
  handlers: {
    POST: async ({ device, req }) => {
      const id = str(req.query.id);
      const body = req.body || {};
      switch (str(req.query.op)) {
        case "join":
          return childJoin(device, id, child.parse(body).childProfileId);
        case "ready":
          return childReady(device, id, child.parse(body).childProfileId);
        case "respond":
          return childRespond(device, id, body, req);
        case "help":
          return childHelp(device, id, child.parse(body).childProfileId);
        default:
          throw new HttpError(404, "Not found");
      }
    },
  },
});
