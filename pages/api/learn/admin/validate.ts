import { route } from "@/learn-together/server/http";
import { validateActivity } from "@/learn-together/domain/schema";
import { projectActivity } from "@/learn-together/domain/projection";

export default route({
  auth: "user",
  roles: ["lt_editor", "lt_reviewer"],
  handlers: {
    POST: async ({ req }) => {
      const r = validateActivity((req.body || {}).content);
      return r.ok ? { ok: true, childPreview: projectActivity(r.content, "full") } : r;
    },
  },
});
