// Client-safe (no Node imports): shared by the server service and the admin UI.
export const ANON_DOMAIN = "anonymized.invalid";
export const isAnonymized = (u) => String((u && u.email) || "").toLowerCase().endsWith(`@${ANON_DOMAIN}`);
