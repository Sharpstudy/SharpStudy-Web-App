import { route } from "@/learn-together/server/http";
import { getFamilyOverview } from "@/learn-together/server/family";
import { realtimeEnabled } from "@/learn-together/server/realtime";

export default route({
  auth: "user",
  handlers: {
    GET: async ({ parent }) => ({
      user: { firstName: parent.firstName, ltRoles: parent.ltRoles, familyRole: parent.familyRole },
      realtime: realtimeEnabled(),
      ...(await getFamilyOverview(parent)),
    }),
  },
});
