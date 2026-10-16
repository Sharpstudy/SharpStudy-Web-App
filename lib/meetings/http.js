import { MeetingError } from "./service";

// Maps MeetingError to a JSON response; anything else is a generic 500 (message logged, never the request body).
export const handle = (fn) => async (req, res) => {
	res.setHeader("Cache-Control", "no-store");
	try {
		await fn(req, res);
	} catch (e) {
		if (e instanceof MeetingError) {
			return res.status(e.status).json({ code: e.code, message: e.message, ...(e.fields ? { fields: e.fields } : {}) });
		}
		console.error(`[meetings] ${req.method} ${String(req.url).split("?")[0]}: ${e && e.message}`);
		res.status(500).json({ code: "server_error", message: "Something went wrong. Please try again." });
	}
};
