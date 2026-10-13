import { route } from "@/learn-together/server/http";
import { createChild, getFamilyOverview } from "@/learn-together/server/family";

export default route({
  auth: "parent",
  handlers: {
    GET: async ({ parent }) => ({ children: (await getFamilyOverview(parent)).children }),
    POST: async ({ parent, req }) => ({ child: await createChild(parent, req.body) }),
  },
});
