import { randomBytes } from "node:crypto";
import type { RequestHandler } from "express";

const V = "5.17.14"; // swagger-ui-dist; swagger-ui-express needs a filesystem, which Workers lack
const CDN = "https://cdn.jsdelivr.net";

export const docsPage: RequestHandler = (_req, res) => {
  const nonce = randomBytes(16).toString("base64");
  res.setHeader(
    "Content-Security-Policy",
    `default-src 'none'; script-src 'nonce-${nonce}' ${CDN}; style-src ${CDN}; img-src data: ${CDN}; connect-src 'self'`,
  );
  res.type("html").send(`<!doctype html><html><head><meta charset="utf-8"><title>API docs</title>
<link rel="stylesheet" href="${CDN}/npm/swagger-ui-dist@${V}/swagger-ui.css"></head>
<body><div id="ui"></div>
<script src="${CDN}/npm/swagger-ui-dist@${V}/swagger-ui-bundle.js"></script>
<script nonce="${nonce}">SwaggerUIBundle({ url: "/openapi.json", dom_id: "#ui" });</script></body></html>`);
};
