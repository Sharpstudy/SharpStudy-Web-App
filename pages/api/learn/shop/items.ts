import { route, str } from "@/learn-together/server/http";
import { listShopItems } from "@/learn-together/server/shop";

export default route({
  auth: "parent",
  handlers: {
    GET: async ({ req }) => {
      const category = str(req.query.category) || undefined;
      return listShopItems(category);
    },
  },
});
