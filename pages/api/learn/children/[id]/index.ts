import { route, str } from "@/learn-together/server/http";
import { deleteChild, updateChild } from "@/learn-together/server/family";
import { requireReauth } from "@/learn-together/server/auth";

export default route({
  auth: "parent",
  handlers: {
    PATCH: async ({ parent, req }) => ({ child: await updateChild(parent, str(req.query.id), req.body) }),
    DELETE: async ({ parent, req }) => {
      requireReauth(req, parent);
      return deleteChild(parent, str(req.query.id));
    },
  },
});
