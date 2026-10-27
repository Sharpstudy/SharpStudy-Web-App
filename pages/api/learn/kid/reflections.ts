import { route, str, badRequest } from "@/learn-together/server/http";
import { getReflections, addReflection } from "@/learn-together/server/reflections";
import { ChildDeviceProfile } from "@/learn-together/server/models";
import { z } from "zod";

const addSchema = z.object({
  childProfileId: z.string().uuid(),
  text: z.string().min(1).max(500),
  mood: z.enum(["great", "good", "okay", "hard"]),
});

export default route({
  auth: "device",
  handlers: {
    GET: async ({ req, device }) => {
      const childProfileId = str(req.query.childProfileId);
      if (!childProfileId) throw badRequest("childProfileId required");
      if (!device.childProfileIds.includes(childProfileId)) throw badRequest("Not authorised for this child");
      return getReflections(childProfileId);
    },
    POST: async ({ req, device }) => {
      const body = addSchema.parse(req.body);
      if (!device.childProfileIds.includes(body.childProfileId)) throw badRequest("Not authorised for this child");
      return addReflection(body.childProfileId, null, body.text, body.mood);
    },
  },
});
