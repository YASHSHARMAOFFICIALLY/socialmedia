import { z } from "zod";
import { badRequest } from "../errors/errors.js";

/** Keyset pagination: opaque cursor encodes the last row's sort key. */
export const pageQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().max(500).optional(),
});

export const encodeCursor = (v: unknown) => Buffer.from(JSON.stringify(v)).toString("base64url");
export function decodeCursor<T>(c: string | undefined, schema: z.ZodType<T>): T | undefined {
  if (!c) return undefined;
  try {
    return schema.parse(JSON.parse(Buffer.from(c, "base64url").toString()));
  } catch {
    throw badRequest("Invalid cursor");
  }
}
export const page = <T>(rows: T[], limit: number, key: (r: T) => unknown) => {
  const items = rows.slice(0, limit);
  return { items, nextCursor: rows.length > limit ? encodeCursor(key(items[items.length - 1] as T)) : null };
};
