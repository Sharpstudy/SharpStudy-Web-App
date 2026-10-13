// First-party product analytics. Properties are allow-listed: never nicknames, notes or raw answers.
import type { IncomingMessage } from "http";
import { AnalyticsEvent } from "./models";
import { familyKey } from "./crypto";

export const LT_EVENTS = [
  "lt_onboarding_completed", "lt_child_profile_created", "lt_pairing_started", "lt_pairing_approved", "lt_pairing_denied",
  "lt_device_revoked", "lt_activity_previewed", "lt_session_launched", "lt_launch_received", "lt_step_sync", "lt_child_ready",
  "lt_child_help_raised", "lt_child_response_submitted", "lt_misconception_observed", "lt_session_resumed", "lt_session_completed",
  "lt_session_abandoned", "lt_check_recorded", "lt_reflection_recorded", "lt_parent_confidence_rated", "lt_concept_status_changed",
  "lt_concept_status_overridden", "lt_usefulness_rated", "lt_confusion_reported", "lt_safety_concern_reported",
  "lt_kit_interest_clicked", "lt_recommendation_followed", "lt_realtime_reconnect", "lt_launch_failed",
] as const;
export type LtEventName = (typeof LT_EVENTS)[number];

const ALLOWED_PROPS = new Set([
  "activityId", "activityVersionId", "subject", "mode", "durationMode", "childCount", "latencyMs", "isCorrect", "outcome",
  "interpretation", "questionKey", "rating", "lastStepIndex", "stepIndex", "fromStatus", "toStatus", "kitKey", "kind", "transport",
  "sessionId", "groupId", "reason",
]);

export function deviceClass(req?: IncomingMessage): string | null {
  const ua = String(req?.headers["user-agent"] || "");
  if (!ua) return null;
  if (/iPad|Tablet|Android(?!.*Mobile)/i.test(ua) || (/Macintosh/.test(ua) && /Mobile/.test(ua))) return "tablet";
  if (/Mobi|iPhone|Android/i.test(ua)) return "phone";
  return "desktop";
}

export function sanitizeProps(props: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(props)) {
    if (!ALLOWED_PROPS.has(k)) continue;
    if (v === null || typeof v === "number" || typeof v === "boolean" || (typeof v === "string" && v.length <= 64)) out[k] = v;
  }
  return out;
}

export async function track(name: LtEventName, props: Record<string, unknown> = {}, opts: { familyId?: string; req?: IncomingMessage } = {}) {
  try {
    await AnalyticsEvent.create({
      name,
      familyKey: opts.familyId ? familyKey(opts.familyId) : null,
      deviceClass: deviceClass(opts.req),
      props: sanitizeProps(props),
      at: new Date(),
    });
  } catch (e) {
    console.error("[learn-together] analytics", name, e instanceof Error ? e.message : e);
  }
}
