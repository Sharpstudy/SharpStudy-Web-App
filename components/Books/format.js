export const money = (cents, currency = "inr") => {
	if (!cents) return "Free";
	try {
		return new Intl.NumberFormat(String(currency).toLowerCase() === "inr" ? "en-IN" : "en-US", { style: "currency", currency: String(currency).toUpperCase() }).format(cents / 100);
	} catch (e) {
		return `${String(currency).toUpperCase()} ${(cents / 100).toFixed(2)}`;
	}
};

export const shortDate = (d) => {
	if (!d) return "";
	try {
		return new Date(d).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
	} catch (e) {
		return "";
	}
};

// Query-string for /books links; empty values are dropped.
export const booksHref = (params = {}) => {
	const q = Object.entries(params)
		.filter(([, v]) => v !== undefined && v !== null && v !== "")
		.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
		.join("&");
	return q ? `/books/?${q}` : "/books/";
};
