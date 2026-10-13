import { route } from "@/learn-together/server/http";
import { z } from "zod";
import { acceptInvite } from "@/learn-together/server/family";

export default route({
  auth: "user",
  handlers: { POST: async ({ parent, req }) => ({ familyId: await acceptInvite(parent, z.object({ token: z.string().min(10).max(200) }).parse(req.body || {}).token) }) },
});
