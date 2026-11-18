/**
 * Where to send the browser after sign-in. `next` comes from the URL, so anyone can craft it: only this site
 * and the API's MCP authorize flow are allowed. Anything else falls back, so login can't redirect off-site.
 */
export function safeNext(raw: string | null, siteOrigin: string, apiOrigin: string, fallback: string): string {
  if (!raw) {
    return fallback;
  }
  let target: URL;
  try {
    target = new URL(raw, siteOrigin);
  } catch {
    return fallback;
  }
  const isSite = target.origin === siteOrigin;
  const isMcpAuthorize = target.origin === apiOrigin && target.pathname.startsWith("/mcp/");
  if (!isSite && !isMcpAuthorize) {
    return fallback;
  }
  return target.href;
}
