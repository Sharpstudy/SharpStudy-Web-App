import { route, str } from "@/learn-together/server/http";
import { tokenRequest } from "@/learn-together/server/realtime";
import { SessionGroup } from "@/learn-together/server/models";
import { channels } from "@/learn-together/domain/sync";
import { notFound } from "@/learn-together/server/errors";

export default route({
  auth: "parent",
  handlers: {
    GET: async ({ parent, req }) => {
      const list = [channels.family(parent.familyId)];
      const groupId = str(req.query.groupId);
      if (groupId) {
        if (!(await SessionGroup.count({ where: { id: groupId, familyId: parent.familyId } }))) throw notFound();
        list.push(channels.group(groupId));
      }
      const tr = await tokenRequest(`parent:${parent.userId}`, list);
      if (!tr) throw notFound("Realtime is not configured");
      return tr;
    },
  },
});
