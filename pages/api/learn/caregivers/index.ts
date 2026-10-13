import { route, str, badRequest } from "@/learn-together/server/http";
import { z } from "zod";
import { createInvite, removeMember, revokeInvite } from "@/learn-together/server/family";
import { requireOwner } from "@/learn-together/server/auth";
import { sendCaregiverInvite } from "@/learn-together/server/email";

export default route({
  auth: "parent",
  handlers: {
    POST: async ({ parent, req }) => {
      requireOwner(parent);
      const { email } = z.object({ email: z.string() }).parse(req.body || {});
      const invite = await createInvite(parent, email);
      const sent = await sendCaregiverInvite(req, parent.firstName, invite.email, invite.token);
      // When email sending is off (dev/preview), the owner gets the link to share themselves.
      return { inviteId: invite.inviteId, emailed: sent.emailed, link: sent.emailed ? undefined : sent.link };
    },
    DELETE: async ({ parent, req }) => {
      requireOwner(parent);
      if (req.query.inviteId) await revokeInvite(parent, str(req.query.inviteId));
      else if (req.query.userId) await removeMember(parent, str(req.query.userId));
      else throw badRequest("inviteId or userId required");
      return { ok: true };
    },
  },
});
