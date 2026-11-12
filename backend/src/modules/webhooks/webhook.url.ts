/** SSRF guard for customer-supplied webhook URLs (Workers also cannot reach private networks; this fails fast with a clear error). */
export function checkWebhookUrl(raw: string, allowInsecure: boolean): string | null {
  let u: URL;
  try { u = new URL(raw); } catch { return "Not a valid URL"; }
  if (u.protocol !== "https:" && !(allowInsecure && u.protocol === "http:")) return "Webhook URLs must use https";
  if (u.username || u.password) return "Credentials in the URL are not allowed";
  const h = u.hostname.toLowerCase();
  if (!allowInsecure) {
    if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal") || !h.includes(".") && !h.startsWith("[")) return "Internal host names are not allowed";
    const v4 = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(h);
    if (v4) {
      const [a, b] = [Number(v4[1]), Number(v4[2])];
      if (a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224) return "Private or reserved addresses are not allowed";
    }
    if (h.startsWith("[")) return "IPv6 literal addresses are not allowed";
  }
  return null;
}
