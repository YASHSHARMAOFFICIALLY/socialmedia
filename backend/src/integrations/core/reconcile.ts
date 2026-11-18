/** A post the platform lists for our own account, mapped to the fields reconciliation compares. */
export interface RecentPost { id: string; text: string; at?: string | undefined; url?: string | undefined }

const ENTITIES: Record<string, string> = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": "\"", "&#39;": "'" };

/**
 * Compares text the way platforms rewrite it: links become t.co (X) or are dropped, media adds a link,
 * entities are escaped, whitespace changes. So links, entities and whitespace are ignored.
 */
function normalize(text: string): string {
  const noLinks = text.replace(/https?:\/\/\S+/g, "");
  const decoded = noLinks.replace(/&(amp|lt|gt|quot|#39);/g, (e) => ENTITIES[e] ?? e);
  return decoded.replace(/\s+/g, "");
}

/**
 * The one matcher every adapter's reconcile uses. A post counts only when it was created after `since`
 * (the start of the attempt whose outcome is unknown) and its id is not already recorded on another job,
 * so an identical recurring post from yesterday can never confirm today's lost one.
 */
export function matchRecentPost(posts: RecentPost[], want: string, since: Date, exclude: readonly string[]): RecentPost | null {
  const target = normalize(want);
  const isMatch = (p: RecentPost) =>
    !!p.at
    && new Date(p.at) >= since
    && !exclude.includes(p.id)
    && normalize(p.text) === target;
  return posts.find(isMatch) ?? null;
}
