import { route } from "@/learn-together/server/http";
import { dashboard } from "@/learn-together/server/metrics";

export default route({
  auth: "user",
  roles: ["lt_admin"],
  handlers: { GET: async ({ req }) => dashboard(Math.min(365, Math.max(7, Number(req.query.days) || 56))) },
});
