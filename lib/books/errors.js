export class BookError extends Error {
	constructor(status, code, message, extra) {
		super(message);
		this.status = status;
		this.code = code;
		this.extra = extra;
	}
}
export const fail = (...a) => {
	throw new BookError(...a);
};
export const isUuid = (v) => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
