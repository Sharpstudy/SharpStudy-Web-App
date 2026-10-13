import { route } from "@/learn-together/server/http";
import { exportFamily } from "@/learn-together/server/privacy";

export default route({
  auth: "parent",
  handlers: {
    GET: async ({ parent, res }) => {
      res.setHeader("Content-Disposition", `attachment; filename="learn-together-family-${new Date().toISOString().slice(0, 10)}.json"`);
      return exportFamily(parent);
    },
  },
});
