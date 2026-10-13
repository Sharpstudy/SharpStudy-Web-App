import { route, str } from "@/learn-together/server/http";
import { exportChild, exportToCsv } from "@/learn-together/server/progress";

export default route({
  auth: "parent",
  handlers: {
    GET: async ({ parent, req, res }) => {
      const data = await exportChild(parent, str(req.query.id));
      const stamp = new Date().toISOString().slice(0, 10);
      if (str(req.query.format) === "csv") {
        res.setHeader("Content-Type", "text/csv; charset=utf-8");
        res.setHeader("Content-Disposition", `attachment; filename="learn-together-${stamp}.csv"`);
        res.status(200).send(exportToCsv(data));
        return;
      }
      res.setHeader("Content-Disposition", `attachment; filename="learn-together-${stamp}.json"`);
      return data;
    },
  },
});
