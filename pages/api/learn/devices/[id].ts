import { route, str } from "@/learn-together/server/http";
import { revokeDevice } from "@/learn-together/server/family";

export default route({
  auth: "parent",
  handlers: {
    DELETE: async ({ parent, req }) => {
      await revokeDevice(parent, str(req.query.id));
      return { ok: true };
    },
  },
});
