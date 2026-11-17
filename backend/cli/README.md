# postrally CLI

Local MCP bridge. See `docs/mcp.md` in the repository for the full guide.

```
postrally mcp login --api-url https://<api>   # browser approval (device flow)
postrally mcp serve                            # stdio MCP server for your MCP client
postrally mcp status
postrally mcp logout
```
Build: `npm run build` in this folder (needs Node 20+). Credentials are stored in the OS credential store when available (macOS Keychain, Linux Secret Service), otherwise a 0600 file under `~/.config/postrally`. Set `POSTRALLY_TOKEN` and `POSTRALLY_API_URL` to use a personal access token instead (CI).
