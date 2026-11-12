// AWS Signature V4 (query-string presigning + header signing) on WebCrypto. R2's S3 API uses region "auto", service "s3".
const te = new TextEncoder();
const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
const sha256Hex = async (s: string | ArrayBuffer) => hex(await crypto.subtle.digest("SHA-256", typeof s === "string" ? te.encode(s) : s));
const hmac = async (key: ArrayBuffer | Uint8Array, data: string) => crypto.subtle.sign("HMAC", await crypto.subtle.importKey("raw", key as ArrayBuffer, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]), te.encode(data));
const enc = (s: string) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

export interface Creds { accessKeyId: string; secretAccessKey: string; region: string; service?: string }
const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, ""); // 20130524T000000Z

async function signingKey(c: Creds, date: string) {
  let k = await hmac(te.encode(`AWS4${c.secretAccessKey}`), date);
  for (const part of [c.region, c.service ?? "s3", "aws4_request"]) k = await hmac(k, part);
  return k;
}

/** Presigned URL. `signedHeaders` (e.g. content-type) must be sent by the client exactly as signed. */
export async function presignUrl(c: Creds, method: string, url: string, expiresS: number, o: { now?: Date; signedHeaders?: Record<string, string> } = {}): Promise<string> {
  const u = new URL(url);
  const now = o.now ?? new Date(), amz = stamp(now), date = amz.slice(0, 8);
  const headers: Record<string, string> = { host: u.host, ...Object.fromEntries(Object.entries(o.signedHeaders ?? {}).map(([k, v]) => [k.toLowerCase(), v.trim()])) };
  const names = Object.keys(headers).sort();
  const scope = `${date}/${c.region}/${c.service ?? "s3"}/aws4_request`;
  const q = new URLSearchParams(u.search);
  q.set("X-Amz-Algorithm", "AWS4-HMAC-SHA256"); q.set("X-Amz-Credential", `${c.accessKeyId}/${scope}`); q.set("X-Amz-Date", amz);
  q.set("X-Amz-Expires", String(expiresS)); q.set("X-Amz-SignedHeaders", names.join(";"));
  const canonicalQuery = [...q.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([k, v]) => `${enc(k)}=${enc(v)}`).join("&");
  const canonical = [method, u.pathname.split("/").map((s) => enc(decodeURIComponent(s))).join("/"), canonicalQuery, names.map((n) => `${n}:${headers[n]}\n`).join(""), names.join(";"), "UNSIGNED-PAYLOAD"].join("\n");
  const toSign = ["AWS4-HMAC-SHA256", amz, scope, await sha256Hex(canonical)].join("\n");
  const sig = hex(await hmac(await signingKey(c, date), toSign));
  return `${u.origin}${u.pathname}?${canonicalQuery}&X-Amz-Signature=${sig}`;
}

/** Authorization headers for a direct request (HEAD / ranged GET / DELETE) with an empty body. */
export async function signHeaders(c: Creds, method: string, url: string, extra: Record<string, string> = {}, now = new Date(), body?: Uint8Array): Promise<Record<string, string>> {
  const u = new URL(url);
  const amz = stamp(now), date = amz.slice(0, 8), payload = await sha256Hex(body ? (body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) as ArrayBuffer) : "");
  const h: Record<string, string> = { host: u.host, "x-amz-content-sha256": payload, "x-amz-date": amz, ...Object.fromEntries(Object.entries(extra).map(([k, v]) => [k.toLowerCase(), v.trim()])) };
  const names = Object.keys(h).sort();
  const scope = `${date}/${c.region}/${c.service ?? "s3"}/aws4_request`;
  const canonicalQuery = [...u.searchParams.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => `${enc(k)}=${enc(v)}`).join("&");
  const canonical = [method, u.pathname.split("/").map((s) => enc(decodeURIComponent(s))).join("/"), canonicalQuery, names.map((n) => `${n}:${h[n]}\n`).join(""), names.join(";"), payload].join("\n");
  const sig = hex(await hmac(await signingKey(c, date), ["AWS4-HMAC-SHA256", amz, scope, await sha256Hex(canonical)].join("\n")));
  const { host: _h, ...send } = h;
  return { ...send, Authorization: `AWS4-HMAC-SHA256 Credential=${c.accessKeyId}/${scope}, SignedHeaders=${names.join(";")}, Signature=${sig}` };
}
