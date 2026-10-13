import { route } from "@/learn-together/server/http";
import { getFamilyOverview, listDevices } from "@/learn-together/server/family";
import { openGroupsForFamily } from "@/learn-together/server/sessions";
import { pendingApprovals } from "@/learn-together/server/pairing";
import { recommendationsFor } from "@/learn-together/server/progress";

export default route({
  auth: "parent",
  handlers: {
    GET: async ({ parent }) => {
      const [overview, devices, open, pending] = await Promise.all([getFamilyOverview(parent), listDevices(parent.familyId), openGroupsForFamily(parent.familyId), pendingApprovals(parent.familyId)]);
      const children = await Promise.all(
        overview.children.map(async (c) => {
          const ds = devices.filter((d) => d.childProfileIds.includes(c.id));
          return { ...c, deviceStatus: !ds.length ? "not_paired" : ds.some((d) => d.online) ? "online" : "offline", recommendation: (await recommendationsFor(parent, c.id, 1))[0] || null };
        })
      );
      return { family: overview.family, children, openGroups: open, pendingApprovals: pending };
    },
  },
});
