import { getAccountActor } from "@/lib/mastery-server/http";
import { ServiceError } from "@/lib/mastery/service";
import liveRepo from "@/lib/live-questions/repo";
import { getImageForViewer } from "@/lib/live-questions/service";

// Streams one image to someone who may see it: the session's instructor, or a participant
// once a question using it has been published in their session.
export default async function handler(req, res) {
	if (req.method !== "GET") return res.status(405).json({ message: "Method not allowed" });
	try {
		const actor = await getAccountActor(req);
		const img = await getImageForViewer(liveRepo, actor, req.query.slug, req.query.imageId);
		res.setHeader("Content-Type", img.mime);
		res.setHeader("Cache-Control", "private, no-store");
		res.setHeader("X-Content-Type-Options", "nosniff");
		res.setHeader("Content-Security-Policy", "default-src 'none'; sandbox");
		res.status(200).send(Buffer.from(img.data));
	} catch (e) {
		if (e instanceof ServiceError) return res.status(e.status).json({ code: e.code, message: e.message });
		res.status(500).json({ message: "Something went wrong." });
	}
}
