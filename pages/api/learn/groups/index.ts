import { route } from "@/learn-together/server/http";
import { launch } from "@/learn-together/server/sessions";

export default route({ auth: "parent", handlers: { POST: async ({ parent, req }) => launch(parent, req.body, req) } });
