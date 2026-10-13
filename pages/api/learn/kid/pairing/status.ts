import { route } from "@/learn-together/server/http";
import { claimStatus } from "@/learn-together/server/pairing";
import { deviceFromCookie } from "@/learn-together/server/auth";

export default route({
  auth: "public",
  handlers: {
    GET: async ({ req, res }) => {
      if (await deviceFromCookie(req)) return { status: "paired" };
      return claimStatus(req, res);
    },
  },
});
