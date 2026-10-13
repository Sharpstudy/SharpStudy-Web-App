import fs from "fs";
import path from "path";
import { validateActivity, type ActivityContent } from "@/learn-together/domain/schema";

export const CONTENT_DIR = path.resolve(__dirname, "../../content/learn-together");

export function loadAllContent(): ActivityContent[] {
  return fs
    .readdirSync(CONTENT_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => {
      const r = validateActivity(JSON.parse(fs.readFileSync(path.join(CONTENT_DIR, f), "utf8")));
      if (!r.ok) throw new Error(`${f}: ${JSON.stringify(r.errors)}`);
      return r.content;
    });
}

export const raw = (slug: string) => JSON.parse(fs.readFileSync(path.join(CONTENT_DIR, `${slug}.json`), "utf8"));
