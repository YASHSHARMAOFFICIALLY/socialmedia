// Run: npx tsx src/lib/safe-next.check.ts  (no frontend test runner; this is the one check for safeNext)
import assert from "node:assert/strict";
import { safeNext } from "./safe-next";

const site = "https://postrally.app";
const api = "https://api.postrally.app";
const go = (raw: string | null) => safeNext(raw, site, api, "/");

assert.equal(go(null), "/");
assert.equal(go("/pricing"), "https://postrally.app/pricing");
assert.equal(go("https://api.postrally.app/mcp/authorize?client_id=x"), "https://api.postrally.app/mcp/authorize?client_id=x");
assert.equal(go("https://evil.test/mcp/authorize"), "/");
assert.equal(go("//evil.test/x"), "/");
assert.equal(go("https://api.postrally.app/api/auth/delete-user"), "/");
assert.equal(go("javascript:alert(1)"), "/");
console.log("safeNext ok");
