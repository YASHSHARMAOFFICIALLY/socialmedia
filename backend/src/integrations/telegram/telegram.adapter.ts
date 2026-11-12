import { PlatformError } from "../core/errors.js";
import { apiFetch } from "../core/http.js";
import { withHashtags } from "../core/rules.js";
import { NO_CAPABILITIES, NO_OAUTH, type SocialAdapter } from "../core/types.js";

// Verified (core.telegram.org/bots/api): POST https://api.telegram.org/bot<token>/<method>; responses {ok, result | description, error_code,
// parameters.retry_after}. Methods used: getMe, getChat, getChatMember, getChatMemberCount, sendMessage, sendPhoto, sendVideo, sendMediaGroup (2-10 items, photos and videos may mix, caption on the first item; result is an array of messages).
// The bot token never expires; the bot must be an administrator of the channel. The Bot API has no channel history or per-message
// view counts, so there is no reconcile and no post analytics; the only metric is the member count (getChatMemberCount).
const api = (token: string, method: string) => `https://api.telegram.org/bot${token}/${method}`;
const classify = (status: number) => (status === 401 ? "auth_expired" as const : status === 403 ? "permanent" as const : undefined);
const post = (body: unknown, signal?: AbortSignal): RequestInit => ({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), ...(signal ? { signal } : {}) });

export function createTelegramAdapter(f: typeof fetch = fetch): SocialAdapter {
  async function call<T>(token: string, method: string, body: unknown, creates = false, signal?: AbortSignal): Promise<T> {
    const res = await apiFetch(f, "telegram", api(token, method), post(body, signal), { creates, classify });
    const j = (await res.json()) as { ok: boolean; result: T; description?: string };
    if (!j.ok) throw new PlatformError("permanent", `telegram ${method} failed${j.description ? `: ${j.description.slice(0, 200)}` : ""}`);
    return j.result;
  }
  return {
    platform: "telegram",
    capabilities: { ...NO_CAPABILITIES, textPost: true, imagePost: true, videoPost: true, carousel: true, accountAnalytics: true },
    oauth: NO_OAUTH,
    async fetchAccount(): Promise<never> { throw new PlatformError("permanent", "telegram channels are connected with credentials"); },
    credentials: {
      fields: [
        { name: "botToken", label: "Bot token", secret: true, help: "Create a bot with @BotFather and copy its token." },
        { name: "chat", label: "Channel (@username or numeric id)", secret: false, help: "Add the bot to the channel as an administrator with permission to post messages." },
      ],
      async connect(fields) {
        const token = fields.botToken!.trim();
        const me = await call<{ id: number; username?: string }>(token, "getMe", {});
        const chat = await call<{ id: number; type: string; title?: string; username?: string }>(token, "getChat", { chat_id: fields.chat!.trim() });
        if (chat.type !== "channel" && chat.type !== "supergroup") throw new PlatformError("permanent", "telegram: the target must be a channel or supergroup");
        const member = await call<{ status: string; can_post_messages?: boolean }>(token, "getChatMember", { chat_id: chat.id, user_id: me.id });
        if (member.status !== "administrator" && member.status !== "creator") throw new PlatformError("permanent", "telegram: the bot must be an administrator of the channel");
        if (chat.type === "channel" && member.can_post_messages === false) throw new PlatformError("permanent", "telegram: the bot lacks the permission to post messages");
        return {
          profile: { externalId: String(chat.id), displayName: chat.title ?? String(chat.id), ...(chat.username ? { username: chat.username } : {}), accountType: "channel", metadata: { chatType: chat.type, botUsername: me.username ?? null } },
          tokens: { accessToken: token, scopes: [] },
        };
      },
    },
    async publish({ accessToken, account, content, media, signal }) {
      const text = withHashtags(content);
      const items = media.filter((x) => x.role === "media");
      const m = items[0];
      const chat_id = account.externalId;
      type Sent = { message_id: number; chat?: { username?: string } };
      const sent = items.length > 1
        ? (await call<Sent[]>(accessToken, "sendMediaGroup", { chat_id, media: await Promise.all(items.map(async (x, i) => ({ type: x.kind === "image" ? "photo" : "video", media: await x.url(), ...(i === 0 && text ? { caption: text } : {}) }))) }, true, signal))[0]!
        : m
          ? await call<Sent>(accessToken, m.kind === "image" ? "sendPhoto" : "sendVideo", { chat_id, [m.kind === "image" ? "photo" : "video"]: await m.url(), ...(text ? { caption: text } : {}) }, true, signal)
          : await call<Sent>(accessToken, "sendMessage", { chat_id, text }, true, signal);
      const user = sent.chat?.username;
      return { externalId: String(sent.message_id), ...(user ? { url: `https://t.me/${user}/${sent.message_id}` } : {}), raw: sent };
    },
    async fetchAccountMetrics({ accessToken, account }) {
      const n = await call<number>(accessToken, "getChatMemberCount", { chat_id: account.externalId });
      return { source: "getChatMemberCount", raw: { count: n }, metrics: [{ originalName: "member_count", value: typeof n === "number" ? n : null, availability: typeof n === "number" ? "available" : "unavailable" }] };
    },
  };
}
