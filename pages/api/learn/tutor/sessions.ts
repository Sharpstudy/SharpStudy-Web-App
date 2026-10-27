import { route, HttpError } from "@/learn-together/server/http";
import { getTutorSessions } from "@/learn-together/server/coaches";

export default route({
  auth: "user",
  handlers: {
    GET: async ({ parent }) => {
      // Any signed-in user can call; returns empty array if not a coach
      const sessions = await getTutorSessions(parent.userId);
      return sessions;
    },
  },
});
