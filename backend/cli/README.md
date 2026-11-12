# distora CLI

Local MCP bridge. See `docs/mcp.md` in the repository for the full guide.

```
distora mcp login --api-url https://<api>   # browser approval (device flow)
distora mcp serve                            # stdio MCP server for your MCP client
distora mcp status
distora mcp logout
```
Build: `npm run build` in this folder (needs Node 20+). Credentials are stored in the OS credential store when available (macOS Keychain, Linux Secret Service), otherwise a 0600 file under `~/.config/distora`. Set `DISTORA_TOKEN` and `DISTORA_API_URL` to use a personal access token instead (CI).
