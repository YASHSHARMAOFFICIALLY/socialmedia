import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { Router, urlencoded } from "express";
import type { Db } from "../../infrastructure/database/db.js";
import type { Logger } from "../../infrastructure/logger/logger.js";
import { auditRepository } from "../audit/audit.repository.js";

// Verified (Meta webhooks docs): GET verification echoes hub.challenge when hub.mode=subscribe and hub.verify_token matches;
// POST deliveries carry `X-Hub-Signature-256: sha256=<HMAC-SHA256(raw body, app secret)>`. Data-deletion/deauthorize callbacks POST a form field
// `signed_request` = base64url(HMAC-SHA256(payload, app secret)) + "." + base64url(JSON payload with user_id); deletion answers { url, confirmation_code }.
const eq = (a: Buffer, b: Buffer) => a.length === b.length && timingSafeEqual(a, b);
const b64u = (s: string) => Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");

export function verifyBodySignature(raw: Buffer, header: string | undefined, secret: string): boolean {
  const m = /^sha256=([0-9a-f]{64})$/.exec(header ?? "");
  return !!m && eq(Buffer.from(m[1]!, "hex"), createHmac("sha256", secret).update(raw).digest());
}
const SIGNED_MAX_AGE_S = 86_400;   // Meta sends these immediately; an old captured request must not be replayable
export function parseSignedRequest(signed: string, secret: string, nowS = Math.floor(Date.now() / 1000)): { user_id?: string } | null {
  const [sig, payload] = signed.split(".", 2);
  if (!sig || !payload) return null;
  if (!eq(b64u(sig), createHmac("sha256", secret).update(payload).digest())) return null;
  try {
    const data = JSON.parse(b64u(payload).toString("utf8")) as { user_id?: string; issued_at?: number };
    if (typeof data.issued_at === "number" && (nowS - data.issued_at > SIGNED_MAX_AGE_S || data.issued_at - nowS > 300)) return null;
    return data;
  } catch { return null; }
}

export interface InboundDeps { db: Db; log: Logger; instagramAppSecret?: string | undefined; instagramVerifyToken?: string | undefined; publicUrl: string; disconnect: (fbUserId: string, purgeData: boolean) => Promise<number> }

export function inboundWebhookRoutes(d: InboundDeps) {
  const r = Router();
  const form = urlencoded({ extended: false, limit: "20kb" });
  const store = async (kind: string, key: string, payload: unknown, result?: string) =>
    (await d.db.query("INSERT INTO webhook_events (provider, kind, dedupe_key, payload, processed_at, result) VALUES ('instagram',$1,$2,$3,now(),$4) ON CONFLICT (provider, dedupe_key) DO NOTHING", [kind, key, JSON.stringify(payload), result ?? null])).rowCount === 1;

  r.get("/webhooks/instagram", (req, res) => {
    if (!d.instagramVerifyToken) { res.status(404).end(); return; }
    const token = String(req.query["hub.verify_token"] ?? "");
    if (req.query["hub.mode"] === "subscribe" && token.length === d.instagramVerifyToken.length && eq(Buffer.from(token), Buffer.from(d.instagramVerifyToken))) res.status(200).type("text/plain").send(String(req.query["hub.challenge"] ?? ""));
    else res.status(403).end();
  });

  r.post("/webhooks/instagram", async (req, res) => {
    if (!d.instagramAppSecret) { res.status(404).end(); return; }
    const raw = (req as unknown as { rawBody?: Buffer }).rawBody;
    if (!raw || !verifyBodySignature(raw, req.header("x-hub-signature-256"), d.instagramAppSecret)) { res.status(401).end(); return; }   // nothing unsigned is ever stored
    // Stored and deduplicated by payload hash (platforms retry). We have not subscribed to any field that triggers an action yet.
    const fresh = await store("event", createHash("sha256").update(raw).digest("hex"), req.body, "stored");
    res.status(200).json({ received: true, duplicate: !fresh });
  });

  const handleSigned = (kind: "deauthorize" | "data_deletion") => [form, async (req: import("express").Request, res: import("express").Response) => {
    if (!d.instagramAppSecret) { res.status(404).end(); return; }
    const data = parseSignedRequest(String(req.body?.signed_request ?? ""), d.instagramAppSecret);
    if (!data?.user_id) { res.status(400).json({ error: { code: "BAD_REQUEST", message: "Invalid signed_request", requestId: req.id } }); return; }
    const code = createHash("sha256").update(`${kind}:${data.user_id}:${Date.now()}:${Math.random()}`).digest("hex").slice(0, 24);
    const n = await d.disconnect(String(data.user_id), kind === "data_deletion");
    await store(kind, code, { userId: "redacted", accountsAffected: n }, n > 0 ? "completed" : "no_matching_accounts");   // never claim a deletion that touched nothing
    if (kind === "data_deletion") res.json({ url: `${d.publicUrl}/webhooks/data-deletion/${code}`, confirmation_code: code });
    else res.json({ success: true });
  }] as const;
  r.post("/webhooks/instagram/deauthorize", ...handleSigned("deauthorize"));
  r.post("/webhooks/instagram/data-deletion", ...handleSigned("data_deletion"));
  r.get("/webhooks/data-deletion/:code", async (req, res) => {
    const row = (await d.db.query<{ result: string; received_at: string }>("SELECT result, received_at FROM webhook_events WHERE provider = 'instagram' AND kind = 'data_deletion' AND dedupe_key = $1", [String(req.params.code)])).rows[0];
    if (!row) { res.status(404).json({ error: { code: "NOT_FOUND", message: "Unknown confirmation code", requestId: req.id } }); return; }
    res.json({ data: { confirmationCode: req.params.code, status: row.result, requestedAt: row.received_at } });
  });
  void auditRepository;
  return r;
}
