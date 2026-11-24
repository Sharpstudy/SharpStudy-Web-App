// Browser-only: attach the signed-in user's login token to requests for our own
// API when the caller did not set an Authorization header. The server never
// trusts anything but the verified token, so this only saves every call site
// from passing the same header (several routes now require it).
import axios from "axios";
import cookie from "js-cookie";

if (typeof window !== "undefined" && !axios.__ssAuthInterceptor) {
	axios.__ssAuthInterceptor = axios.interceptors.request.use((config) => {
		const url = String(config.url || "");
		const own = url.startsWith("/api/") || url.startsWith(window.location.origin + "/api/");
		if (own) {
			const token = cookie.get("edmy_users_token");
			config.headers = config.headers || {};
			if (token && !config.headers.Authorization && !config.headers.authorization) config.headers.Authorization = token;
		}
		return config;
	});
}
