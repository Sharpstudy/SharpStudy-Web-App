import { Subscription } from "./models";

export interface SubscriptionRow {
  id: string;
  familyId: string;
  plan: "free" | "family" | "family_pro";
  stripeSubscriptionId: string | null;
  stripeCustomerId: string | null;
  currentPeriodEnd: string | null;
  canceledAt: string | null;
}

export async function getSubscription(familyId: string): Promise<SubscriptionRow | null> {
  const row = await Subscription.findOne({ where: { familyId } });
  if (!row) return null;
  return toRow(row);
}

export async function upsertSubscription(
  familyId: string,
  plan: "free" | "family" | "family_pro",
  stripeSubscriptionId: string | null,
  stripeCustomerId: string | null,
  currentPeriodEnd: Date | null
): Promise<SubscriptionRow> {
  const existing = await Subscription.findOne({ where: { familyId } });
  if (existing) {
    await existing.update({ plan, stripeSubscriptionId, stripeCustomerId, currentPeriodEnd });
    return toRow(existing);
  }
  const row = await Subscription.create({ familyId, plan, stripeSubscriptionId, stripeCustomerId, currentPeriodEnd });
  return toRow(row);
}

function toRow(r: any): SubscriptionRow {
  return {
    id: r.id,
    familyId: r.familyId,
    plan: r.plan,
    stripeSubscriptionId: r.stripeSubscriptionId || null,
    stripeCustomerId: r.stripeCustomerId || null,
    currentPeriodEnd: r.currentPeriodEnd ? new Date(r.currentPeriodEnd).toISOString() : null,
    canceledAt: r.canceledAt ? new Date(r.canceledAt).toISOString() : null,
  };
}
