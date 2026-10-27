import { route, badRequest } from "@/learn-together/server/http";
import { listShopItems, recordPurchase } from "@/learn-together/server/shop";
import { z } from "zod";

const schema = z.object({ itemId: z.string().uuid() });

export default route({
  auth: "parent",
  handlers: {
    POST: async ({ req, parent }) => {
      const { itemId } = schema.parse(req.body);
      const items = await listShopItems();
      const item = items.find((i) => i.id === itemId);
      if (!item) throw badRequest("Item not found");
      const purchase = await recordPurchase(parent.familyId, parent.userId, itemId, item.priceCents, "pending");
      return purchase;
    },
  },
});
