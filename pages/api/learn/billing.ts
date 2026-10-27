import { route } from "@/learn-together/server/http";
import { getSubscription } from "@/learn-together/server/subscription";
import { FamilyMember, ChildProfile } from "@/learn-together/server/models";
import User from "@/database/models/user";

export default route({
  auth: "parent",
  handlers: {
    GET: async ({ parent }) => {
      const [subscription, members, children] = await Promise.all([
        getSubscription(parent.familyId),
        FamilyMember.findAll({ where: { familyId: parent.familyId } }),
        ChildProfile.findAll({ where: { familyId: parent.familyId } }),
      ]);

      const userIds = members.map((m) => m.userId);
      const users = userIds.length
        ? await (User as any).findAll({ where: { id: userIds } })
        : [];
      const userMap = new Map(users.map((u: any) => [u.id, u]));

      return {
        subscription: subscription || { plan: "free", currentPeriodEnd: null, canceledAt: null },
        members: members.map((m) => {
          const u: any = userMap.get(m.userId) || {};
          return { userId: m.userId, role: m.role, firstName: u.firstName || u.first_name || "", email: u.email || "" };
        }),
        childCount: children.length,
      };
    },
  },
});
