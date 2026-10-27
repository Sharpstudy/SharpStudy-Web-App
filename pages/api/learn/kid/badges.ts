import { route, str, badRequest } from "@/learn-together/server/http";
import { getFamilyBadges } from "@/learn-together/server/badges";

export default route({
  auth: "device",
  handlers: {
    GET: async ({ req, device }) => {
      const familyId = device.familyId;
      return getFamilyBadges(familyId);
    },
  },
});
