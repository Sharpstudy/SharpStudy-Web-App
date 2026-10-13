import { route, str } from "@/learn-together/server/http";
import { recommendationsFor } from "@/learn-together/server/progress";

export default route({
  auth: "parent",
  handlers: { GET: async ({ parent, req }) => ({ recommendations: await recommendationsFor(parent, str(req.query.id), 3) }) },
});
