import { route } from "@/learn-together/server/http";
import { z } from "zod";
import User from "@/database/models/user";
import { RoleAssignment } from "@/learn-together/server/models";
import { audit } from "@/learn-together/server/audit";
import { notFound } from "@/learn-together/server/errors";

const body = z.object({ email: z.string().email(), role: z.enum(["lt_editor", "lt_reviewer", "lt_admin"]) });

async function userByEmail(email: string) {
  const u = (await (User as any).findOne({ where: { email } })) as any;
  if (!u) throw notFound("No user with that email");
  return u;
}

export default route({
  auth: "user",
  roles: ["lt_admin"],
  handlers: {
    GET: async () => {
      const rows = await RoleAssignment.findAll();
      const users = rows.length ? ((await (User as any).findAll({ where: { id: rows.map((r) => r.userId) }, attributes: ["id", "email", "first_name"] })) as any[]) : [];
      return { assignments: rows.map((r) => ({ role: r.role, email: users.find((u) => u.id === r.userId)?.email, name: users.find((u) => u.id === r.userId)?.first_name })) };
    },
    POST: async ({ parent, req }) => {
      const b = body.parse(req.body || {});
      const u = await userByEmail(b.email);
      if (!(await RoleAssignment.count({ where: { userId: u.id, role: b.role } }))) await RoleAssignment.create({ userId: u.id, role: b.role, grantedByUserId: parent.userId });
      await audit({ type: "user", id: parent.userId }, "role.granted", "lt_role_assignment", u.id, null, { role: b.role });
      return { ok: true };
    },
    DELETE: async ({ parent, req }) => {
      const b = body.parse(req.body || {});
      const u = await userByEmail(b.email);
      await RoleAssignment.destroy({ where: { userId: u.id, role: b.role } });
      await audit({ type: "user", id: parent.userId }, "role.revoked", "lt_role_assignment", u.id, { role: b.role });
      return { ok: true };
    },
  },
});
