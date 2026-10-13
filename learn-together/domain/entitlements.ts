// Single entitlement check for Learn Together. There is no subscription billing in Sharp Study
// today, so the free tier is everything marked `tier: free`; staff roles see everything.

export type LtFeature = "activity:free" | "activity:paid";

export interface EntitlementSubject {
  role?: string | null; // existing users.role
  ltRoles?: string[];
}

export function hasEntitlement(user: EntitlementSubject | null | undefined, feature: LtFeature): boolean {
  if (!user) return false;
  if (feature === "activity:free") return true;
  return user.role === "admin" || (user.ltRoles || []).some((r) => r === "lt_admin" || r === "lt_editor" || r === "lt_reviewer");
}

export function canAccessTier(user: EntitlementSubject | null | undefined, tier: "free" | "paid"): boolean {
  return hasEntitlement(user, tier === "free" ? "activity:free" : "activity:paid");
}
