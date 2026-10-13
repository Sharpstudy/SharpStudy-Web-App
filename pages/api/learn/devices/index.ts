import { route } from "@/learn-together/server/http";
import { listDevices } from "@/learn-together/server/family";

export default route({ auth: "parent", handlers: { GET: async ({ parent }) => ({ devices: await listDevices(parent.familyId) }) } });
