// Browser fetch helpers. Parent calls carry the existing Sharp Study JWT exactly like the rest
// of the app; child-device calls rely on the httpOnly device cookie and never send a JWT.
import cookie from "js-cookie";

export class ApiError extends Error {
  constructor(public status: number, message: string, public code?: string, public body?: any) {
    super(message);
  }
}

// next.config.js sets trailingSlash: true, so "/api/x" would cost a 308 redirect on every call.
export function withSlash(path: string) {
  const [p, q] = path.split("?");
  return `${p.endsWith("/") ? p : `${p}/`}${q !== undefined ? `?${q}` : ""}`;
}

async function request<T>(path: string, init: RequestInit & { json?: unknown; reauth?: string | null } = {}, parent = true): Promise<T> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (init.json !== undefined) headers["Content-Type"] = "application/json";
  if (parent) {
    const token = cookie.get("edmy_users_token");
    if (token) headers.Authorization = token;
  }
  if (init.reauth) headers["x-lt-reauth"] = init.reauth;
  const res = await fetch(withSlash(path), { ...init, headers: { ...headers, ...(init.headers as Record<string, string>) }, body: init.json !== undefined ? JSON.stringify(init.json) : init.body, credentials: "same-origin", cache: "no-store" });
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  const body = text ? (() => { try { return JSON.parse(text); } catch { return text; } })() : undefined;
  if (!res.ok) throw new ApiError(res.status, (body && body.message) || "Something went wrong", body && body.code, body);
  return body as T;
}

export const parentApi = {
  get: <T,>(p: string) => request<T>(p),
  post: <T,>(p: string, json?: unknown, reauth?: string | null) => request<T>(p, { method: "POST", json: json ?? {}, reauth }),
  put: <T,>(p: string, json?: unknown) => request<T>(p, { method: "PUT", json: json ?? {} }),
  patch: <T,>(p: string, json?: unknown) => request<T>(p, { method: "PATCH", json: json ?? {} }),
  del: <T,>(p: string, reauth?: string | null, json?: unknown) => request<T>(p, { method: "DELETE", reauth, json }),
};

export const kidApi = {
  get: <T,>(p: string) => request<T>(p, {}, false),
  post: <T,>(p: string, json?: unknown) => request<T>(p, { method: "POST", json: json ?? {} }, false),
};

export function signedIn() {
  return !!cookie.get("edmy_users_token");
}

/** Downloads a parent-authenticated file (export) without putting anything in the URL beyond ids. */
export async function download(path: string, filename: string) {
  const token = cookie.get("edmy_users_token");
  const res = await fetch(withSlash(path), { headers: token ? { Authorization: token } : {}, credentials: "same-origin" });
  if (!res.ok) throw new ApiError(res.status, "Download failed");
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
