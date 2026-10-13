import { route, str } from "@/learn-together/server/http";
import { progressPage } from "@/learn-together/server/progress";

const date = (v: string) => (v && !Number.isNaN(Date.parse(v)) ? new Date(v) : undefined);

export default route({
  auth: "parent",
  handlers: {
    GET: async ({ parent, req }) => {
      const to = date(str(req.query.to));
      if (to) to.setUTCHours(23, 59, 59, 999);
      return progressPage(parent, str(req.query.id), { from: date(str(req.query.from)), to });
    },
  },
});
