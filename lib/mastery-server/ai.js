// Server-only Claude client for the Sage tutor. ANTHROPIC_API_KEY is read
// from the server environment here and nowhere else; it is never exposed
// through next.config.js `env`, API responses or logs.
import Anthropic from "@anthropic-ai/sdk";

// Models that accept server-side refusal fallbacks in "default" mode.
const FALLBACK_MODELS = new Set(["claude-opus-5-5", "claude-sonnet-5-5"]);

let client = null;

export function tutorAiConfigured() {
	return !!process.env.ANTHROPIC_API_KEY;
}

// Returns { complete } or null when no key is configured (tutor then uses
// its deterministic fallbacks).
export function getTutorAi() {
	if (!tutorAiConfigured()) return null;
	if (!client) client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, timeout: 20000, maxRetries: 1 });
	return {
		async complete({ model, system, messages }) {
			const params = {
				model,
				// Replies are ~3 sentences; headroom covers the model's thinking.
				max_tokens: 2000,
				// Short, simple tutoring: low effort keeps latency and cost down.
				output_config: { effort: "low" },
				system,
				messages,
			};
			if (FALLBACK_MODELS.has(model)) {
				params.betas = ["server-side-fallback-2026-07-01"];
				params.fallbacks = "default";
			}
			try {
				const res = await client.beta.messages.create(params);
				if (res.stop_reason === "refusal") return null;
				return res.content
					.filter((b) => b.type === "text")
					.map((b) => b.text)
					.join(" ")
					.trim();
			} catch (e) {
				// Never log request content; status/type is enough to diagnose.
				if (e instanceof Anthropic.RateLimitError) console.warn("[sage] rate limited by Claude API");
				else if (e instanceof Anthropic.AuthenticationError) console.error("[sage] Claude API key rejected");
				else if (e instanceof Anthropic.APIError) console.error(`[sage] Claude API error ${e.status}`);
				else console.error("[sage] Claude API unreachable");
				return null;
			}
		},
	};
}
