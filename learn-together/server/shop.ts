import { ShopItem, ShopPurchase } from "./models";

export interface ShopItemRow {
  id: string;
  name: string;
  description: string | null;
  category: string;
  imageKey: string | null;
  priceCents: number;
  stripeProductId: string | null;
}

export async function listShopItems(category?: string): Promise<ShopItemRow[]> {
  const where: Record<string, unknown> = { active: true };
  if (category && category !== "all") where.category = category;
  const rows = await ShopItem.findAll({ where, order: [["name", "ASC"]] });
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    description: r.description || null,
    category: r.category,
    imageKey: r.imageKey || null,
    priceCents: r.priceCents,
    stripeProductId: r.stripeProductId || null,
  }));
}

export async function recordPurchase(
  familyId: string,
  userId: string,
  itemId: string,
  pricePaidCents: number,
  stripePaymentIntentId: string
): Promise<{ id: string }> {
  const row = await ShopPurchase.create({
    familyId,
    userId,
    shopItemId: itemId,
    pricePaidCents,
    stripePaymentIntentId,
    purchasedAt: new Date(),
  });
  return { id: row.id };
}
