import { route, badRequest } from "@/learn-together/server/http";
import { track } from "@/learn-together/server/analytics";
import { ChildProfile, Family } from "@/learn-together/server/models";

export default route({
  auth: "parent",
  handlers: {
    POST: async ({ parent, req }) => {
      const [family, kids] = await Promise.all([Family.findByPk(parent.familyId), ChildProfile.count({ where: { familyId: parent.familyId } })]);
      if (!family?.familyPinHash || !kids) throw badRequest("Add a child and set a family PIN first");
      await track("lt_onboarding_completed", { childCount: kids }, { familyId: parent.familyId, req });
      return { ok: true };
    },
  },
});
