/// <reference types="@cloudflare/workers-types" />
declare module "cloudflare:node" {
  export function httpServerHandler(opts: { port: number } | import("node:http").Server): ExportedHandler;
}
