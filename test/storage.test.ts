import { describe, it, expect } from "vitest";
import { presignUrl } from "../src/infrastructure/storage/sigv4.js";
import { createR2Storage } from "../src/infrastructure/storage/storage.js";
import { isValidTimeZone, localDate, localIso, zonedLocalToUtc } from "../src/shared/utils/timezone.js";

describe("SigV4 presigning", () => {
  it("matches the AWS documented test vector", async () => {
    // https://docs.aws.amazon.com/AmazonS3/latest/API/sigv4-query-string-auth.html (examplebucket GET /test.txt, 86400s)
    const url = await presignUrl({ accessKeyId: "AKIAIOSFODNN7EXAMPLE", secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY", region: "us-east-1" }, "GET", "https://examplebucket.s3.amazonaws.com/test.txt", 86400, { now: new Date("2013-05-24T00:00:00Z") });
    expect(url).toContain("X-Amz-Signature=aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404");
    expect(url).toContain("X-Amz-SignedHeaders=host");
  });
  it("R2 URLs use the account endpoint, region auto, and sign the content type for uploads", async () => {
    const st = createR2Storage({ accountId: "acc", accessKeyId: "AK", secretAccessKey: "SK", bucket: "media" });
    const put = await st.presignPut("ws1/a b/file.jpg", { contentType: "image/jpeg", expiresS: 600 });
    const u = new URL(put.url);
    expect(u.host).toBe("acc.r2.cloudflarestorage.com");
    expect(u.pathname).toBe("/media/ws1/a%20b/file.jpg");
    expect(u.searchParams.get("X-Amz-SignedHeaders")).toBe("content-type;host;if-none-match");   // create-only upload: cannot replace verified bytes
    expect(u.searchParams.get("X-Amz-Credential")).toContain("/auto/s3/aws4_request");
    expect(u.searchParams.get("X-Amz-Expires")).toBe("600");
    expect(put.headers).toEqual({ "Content-Type": "image/jpeg", "If-None-Match": "*" });
    expect(new URL(await st.presignGet("k", 60)).searchParams.get("X-Amz-SignedHeaders")).toBe("host");
  });
  it("signed HEAD/GET/DELETE requests carry an Authorization header and treat 404 correctly", async () => {
    const seen: { method: string; auth?: string | null; range?: string | null }[] = [];
    const f = (async (_u: string, init: RequestInit = {}) => {
      const h = new Headers(init.headers);
      seen.push({ method: init.method ?? "GET", auth: h.get("authorization"), range: h.get("range") });
      return init.method === "HEAD" ? new Response(null, { status: 200, headers: { "content-length": "42", "content-type": "image/png" } }) : init.method === "DELETE" ? new Response(null, { status: 404 }) : new Response(new Uint8Array([1, 2, 3]), { status: 206 });
    }) as unknown as typeof fetch;
    const st = createR2Storage({ accountId: "a", accessKeyId: "AK", secretAccessKey: "SK", bucket: "b" }, f);
    expect(await st.head("k")).toEqual({ size: 42, contentType: "image/png" });
    expect([...(await st.readRange("k", 0, 2))]).toEqual([1, 2, 3]);
    await st.delete("k");                                  // 404 on delete is fine (idempotent)
    expect(seen.every((s) => s.auth?.startsWith("AWS4-HMAC-SHA256 Credential=AK/"))).toBe(true);
    expect(seen[1]!.range).toBe("bytes=0-2");
  });
});

describe("timezone conversion", () => {
  const ok = (local: string, tz: string) => { const r = zonedLocalToUtc(local, tz); if (!r.ok) throw new Error(r.reason); return r; };
  it("converts wall-clock time in a zone to the right UTC instant (incl. half-hour zones)", () => {
    expect(ok("2026-12-01T09:00", "America/New_York").utc.toISOString()).toBe("2026-12-01T14:00:00.000Z");
    expect(ok("2026-07-01T09:00", "America/New_York").utc.toISOString()).toBe("2026-07-01T13:00:00.000Z");   // DST offset differs
    expect(ok("2026-12-01T09:00", "Asia/Kolkata").utc.toISOString()).toBe("2026-12-01T03:30:00.000Z");
    expect(ok("2026-12-01T09:00", "UTC").utc.toISOString()).toBe("2026-12-01T09:00:00.000Z");
  });
  it("rejects times that do not exist (DST gap) and flags times that happen twice (DST overlap)", () => {
    expect(zonedLocalToUtc("2026-03-08T02:30", "America/New_York")).toEqual({ ok: false, reason: "nonexistent_local_time" });
    const overlap = ok("2026-11-01T01:30", "America/New_York");
    expect(overlap.ambiguous).toBe(true);
    expect(overlap.utc.toISOString()).toBe("2026-11-01T05:30:00.000Z");                                      // earlier of the two
  });
  it("validates input", () => {
    expect(zonedLocalToUtc("2026-12-01T09:00", "Mars/Base")).toEqual({ ok: false, reason: "invalid_timezone" });
    expect(zonedLocalToUtc("2026-02-30T09:00", "UTC")).toEqual({ ok: false, reason: "invalid_datetime" });
    expect(zonedLocalToUtc("tomorrow", "UTC")).toEqual({ ok: false, reason: "invalid_datetime" });
    expect(isValidTimeZone("Europe/Paris")).toBe(true);
  });
  it("groups by local calendar day", () => {
    expect(localDate("2026-12-01T23:30:00Z", "Asia/Kolkata")).toBe("2026-12-02");
    expect(localIso("2026-12-01T14:00:00Z", "America/New_York")).toBe("2026-12-01T09:00:00");
  });
});
