export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}
export const notFound = (what = "Resource") => new AppError(404, "NOT_FOUND", `${what} not found`);
export const badRequest = (msg: string, details?: unknown) => new AppError(400, "BAD_REQUEST", msg, details);
export const unauthorized = () => new AppError(401, "UNAUTHORIZED", "Authentication required");
export const forbidden = () => new AppError(403, "FORBIDDEN", "Forbidden");
