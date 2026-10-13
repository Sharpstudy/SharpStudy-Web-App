import { route } from "@/learn-together/server/http";
import { deleteFamilyData } from "@/learn-together/server/privacy";
import { requireReauth } from "@/learn-together/server/auth";

export default route({
  auth: "parent",
  handlers: {
    POST: async ({ parent, req }) => {
      requireReauth(req, parent);
      await deleteFamilyData(parent);
      return { ok: true };
    },
  },
});
