export class HttpError extends Error {
  constructor(public status: number, message: string, public code?: string) {
    super(message);
  }
}
export const notFound = (what = "Not found") => new HttpError(404, what);
export const forbidden = (what = "Forbidden") => new HttpError(403, what);
export const badRequest = (what: string, code?: string) => new HttpError(400, what, code);
