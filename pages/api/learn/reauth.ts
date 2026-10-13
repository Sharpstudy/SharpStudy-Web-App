import { route } from "@/learn-together/server/http";
import bcrypt from "bcrypt";
import { z } from "zod";
import User from "@/database/models/user";
import { issueReauth } from "@/learn-together/server/auth";
import { HttpError } from "@/learn-together/server/errors";
import { rateLimit } from "@/learn-together/server/rateLimit";

export default route({
  auth: "user",
  handlers: {
    POST: async ({ parent, req }) => {
      await rateLimit(`reauth:${parent.userId}`, 5, 900);
      const { password } = z.object({ password: z.string().min(1).max(200) }).parse(req.body || {});
      const user = (await (User as any).findOne({ where: { id: parent.userId } })) as any;
      if (!user || !(await bcrypt.compare(password, user.password))) throw new HttpError(401, "That password isn't right");
      return { reauthToken: issueReauth(parent.userId) };
    },
  },
});
