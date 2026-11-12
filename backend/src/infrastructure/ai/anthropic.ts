import { AiProviderError, type AiProvider } from "./provider.js";

/** Anthropic Messages API over plain fetch (no SDK). POST /v1/messages with x-api-key and anthropic-version headers. */
export function createAnthropicProvider(cfg: { apiKey: string; model: string }, f: typeof fetch = fetch): AiProvider {
  return {
    name: `anthropic:${cfg.model}`,
    async generate({ system, user, maxTokens, signal }) {
      let res: Response;
      try {
        res = await f("https://api.anthropic.com/v1/messages", {
          method: "POST", signal: signal ?? AbortSignal.timeout(30_000),
          headers: { "x-api-key": cfg.apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
          body: JSON.stringify({ model: cfg.model, max_tokens: maxTokens, system, messages: [{ role: "user", content: user }] }),
        });
      } catch (e) { throw new AiProviderError(`AI provider unreachable: ${(e as Error).name}`, true); }
      if (!res.ok) throw new AiProviderError(`AI provider responded ${res.status}`, res.status === 429 || res.status >= 500);
      const body = (await res.json()) as { content?: { type: string; text?: string }[] };
      const text = body.content?.filter((c) => c.type === "text").map((c) => c.text ?? "").join("") ?? "";
      if (!text) throw new AiProviderError("AI provider returned no text", true);
      return text;
    },
  };
}
