// Deterministic, evidence-based insights. Every rule states the data it used and refuses to speak when the sample is too small.
// New providers (including AI-generated ones) implement `InsightProvider` and are simply appended; rules never call an LLM.

export interface PostPerf { jobId: string; platform: string; publishedAt: string; format: "text" | "image" | "video"; interactions: number | null; views: number | null; impressions: number | null; reach: number | null }
export interface WindowGain { platform: string; a: number | null; b: number | null }          // a = recent window, b = the window before it
export interface Dataset {
  range: { from: string; to: string }; timezone: string;
  posts: PostPerf[]; published: { platform: string; publishedAt: string }[];
  interactionGain: WindowGain[]; gainWindows: { recent: { from: string; to: string }; previous: { from: string; to: string } };
  followers: { platform: string; latest: number; change: number | null }[];
}
export interface Insight { type: string; severity: "info" | "positive" | "warning"; title: string; message: string; evidence: Record<string, unknown> }
export interface Skipped { type: string; reason: string }
export interface Recommendation { action: string; because: string; basedOn: string; caveat: string }
export interface InsightResult { insights: Insight[]; skipped: Skipped[] }
export type InsightProvider = (d: Dataset) => Promise<InsightResult> | InsightResult;

export const MIN_POSTS = 5;
const EVIDENCE_NOTE = "Interactions are the sum of the components each platform reports (likes, comments, shares, ...), so platforms are compared with that caveat.";

export const median = (xs: number[]) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b), m = s.length >> 1; return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2; };
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const round = (n: number | null, d = 1) => (n === null ? null : Math.round(n * 10 ** d) / 10 ** d);
const withData = (posts: PostPerf[]) => posts.filter((p) => p.interactions !== null) as (PostPerf & { interactions: number })[];
const by = <T>(xs: T[], key: (x: T) => string) => { const m = new Map<string, T[]>(); for (const x of xs) (m.get(key(x)) ?? m.set(key(x), []).get(key(x))!).push(x); return m; };
const cap = (s: string) => s[0]!.toUpperCase() + s.slice(1);

/** Which platform's posts earn more interactions per post (median, so one viral post does not decide). */
export function bestPlatform(d: Dataset): { insight?: Insight; skip?: Skipped } {
  const groups = [...by(withData(d.posts), (p) => p.platform)].map(([platform, ps]) => ({ platform, n: ps.length, median: median(ps.map((p) => p.interactions))!, mean: mean(ps.map((p) => p.interactions))! }));
  const enough = groups.filter((g) => g.n >= MIN_POSTS).sort((a, b) => b.median - a.median);
  if (enough.length < 2) return { skip: { type: "best_platform", reason: `Needs at least ${MIN_POSTS} posts with interaction data on two platforms; found ${groups.map((g) => `${g.platform}: ${g.n}`).join(", ") || "none"}.` } };
  const [top, second] = enough as [typeof enough[0], typeof enough[0]];
  const ratio = second.median > 0 ? top.median / second.median : null;
  const clear = ratio === null ? top.median > 0 : ratio >= 1.2;
  return { insight: {
    type: "best_platform", severity: clear ? "positive" : "info", title: clear ? `${cap(top.platform)} posts perform best` : "No clear difference between platforms",
    message: clear ? `Your ${top.platform} posts received higher engagement than your ${second.platform} posts between ${d.range.from} and ${d.range.to} (median ${round(top.median)} vs ${round(second.median)} interactions per post).` : `Your ${top.platform} and ${second.platform} posts received similar engagement (median ${round(top.median)} vs ${round(second.median)} interactions per post).`,
    evidence: { range: d.range, metric: "interactions per post (median)", platforms: enough.map((g) => ({ platform: g.platform, posts: g.n, median: round(g.median), mean: round(g.mean) })), ratio: round(ratio, 2), note: EVIDENCE_NOTE },
  } };
}

/** Within ONE platform: does video/image/text earn more? (Never across platforms: formats mean different things there.) */
export function formatPerformance(d: Dataset): { insights: Insight[]; skips: Skipped[] } {
  const insights: Insight[] = [], skips: Skipped[] = [];
  for (const [platform, ps] of by(withData(d.posts), (p) => p.platform)) {
    const fm = [...by(ps, (p) => p.format)].map(([format, xs]) => ({ format, n: xs.length, median: median(xs.map((p) => p.interactions))! })).filter((f) => f.n >= MIN_POSTS).sort((a, b) => b.median - a.median);
    if (fm.length < 2) { skips.push({ type: "format_performance", reason: `${platform}: needs at least ${MIN_POSTS} posts in two formats; found ${[...by(ps, (p) => p.format)].map(([f, xs]) => `${f}: ${xs.length}`).join(", ")}.` }); continue; }
    const [a, b] = fm as [typeof fm[0], typeof fm[0]];
    const ratio = b.median > 0 ? a.median / b.median : null;
    if (ratio !== null && ratio < 1.25) { skips.push({ type: "format_performance", reason: `${platform}: ${a.format} and ${b.format} perform similarly (${round(ratio, 2)}x).` }); continue; }
    insights.push({ type: "format_performance", severity: "positive", title: `${cap(a.format)} posts lead on ${cap(platform)}`,
      message: `Your ${platform} ${a.format} posts generated ${ratio === null ? "more" : `${round(ratio, 1)}x the`} interactions of ${b.format} posts (median ${round(a.median)} vs ${round(b.median)}).`,
      evidence: { range: d.range, platform, formats: fm.map((f) => ({ format: f.format, posts: f.n, median: round(f.median) })), ratio: round(ratio, 2), note: "Correlation within the selected period; content quality and timing also differ between formats." } });
  }
  return { insights, skips };
}

/** Interactions gained in the last 7 days vs the 7 days before (change in lifetime counters, so it includes engagement on older posts). */
export function engagementChange(d: Dataset): { insight?: Insight; skip?: Skipped } {
  const known = d.interactionGain.filter((g) => g.a !== null && g.b !== null);
  if (!known.length) return { skip: { type: "engagement_change", reason: "Needs interaction data collected in both the last 7 days and the 7 days before." } };
  const a = known.reduce((s, g) => s + g.a!, 0), b = known.reduce((s, g) => s + g.b!, 0);
  if (b <= 0) return { skip: { type: "engagement_change", reason: "No engagement gained in the previous period, so a percentage change is not meaningful." } };
  const pct = (a - b) / b, dir = pct >= 0.1 ? "increased" : pct <= -0.1 ? "decreased" : "stayed about the same";
  return { insight: { type: "engagement_change", severity: pct >= 0.1 ? "positive" : pct <= -0.1 ? "warning" : "info", title: `Engagement ${dir}`,
    message: `Your engagement ${dir} compared with the previous seven days (${a} vs ${b} interactions gained${Math.abs(pct) >= 0.1 ? `, ${pct > 0 ? "+" : ""}${round(pct * 100, 0)}%` : ""}).`,
    evidence: { recent: d.gainWindows.recent, previous: d.gainWindows.previous, recentGain: a, previousGain: b, changePct: round(pct * 100, 1), platformsIncluded: known.map((g) => g.platform), note: EVIDENCE_NOTE } } };
}

export function postingConsistency(d: Dataset): { insight?: Insight; skip?: Skipped } {
  const days = Math.max(1, Math.round((Date.parse(d.range.to) - Date.parse(d.range.from)) / 86_400_000) + 1);
  if (!d.published.length) return { skip: { type: "posting_consistency", reason: "No posts were published in this period." } };
  const times = d.published.map((p) => Date.parse(p.publishedAt)).sort((a, b) => a - b);
  const gaps = times.slice(1).map((t, i) => (t - times[i]!) / 86_400_000);
  const longest = gaps.length ? Math.max(...gaps) : 0;
  const weeks = Math.max(1, Math.ceil(days / 7)), activeWeeks = new Set(times.map((t) => Math.floor((t - Date.parse(d.range.from)) / (7 * 86_400_000)))).size;
  const sparse = weeks >= 3 && activeWeeks / weeks < 0.5;
  return { insight: { type: "posting_consistency", severity: sparse ? "warning" : "info", title: sparse ? "Posting has been irregular" : "Posting consistency",
    message: `You published ${times.length} post${times.length === 1 ? "" : "s"} in ${days} days, in ${activeWeeks} of ${weeks} weeks; the longest gap was ${round(longest, 1)} days.`,
    evidence: { range: d.range, posts: times.length, weeksWithPosts: activeWeeks, weeks, longestGapDays: round(longest, 1), postsPerWeek: round(times.length / (days / 7), 1) } } };
}

export function followerTrend(d: Dataset): { insights: Insight[]; skips: Skipped[] } {
  const insights: Insight[] = [], skips: Skipped[] = [];
  for (const f of d.followers) {
    if (f.change === null) { skips.push({ type: "follower_trend", reason: `${f.platform}: no follower count from before ${d.range.from}, so growth cannot be computed.` }); continue; }
    insights.push({ type: "follower_trend", severity: f.change > 0 ? "positive" : f.change < 0 ? "warning" : "info", title: `${cap(f.platform)} audience ${f.change > 0 ? "grew" : f.change < 0 ? "shrank" : "is flat"}`,
      message: `Your ${f.platform} audience ${f.change > 0 ? "grew by" : f.change < 0 ? "shrank by" : "changed by"} ${Math.abs(f.change)} to ${f.latest} between ${d.range.from} and ${d.range.to}.`, evidence: { range: d.range, platform: f.platform, latest: f.latest, change: f.change } });
  }
  return { insights, skips };
}

const BLOCKS = [[0, 6, "night (00-06)"], [6, 12, "morning (06-12)"], [12, 18, "afternoon (12-18)"], [18, 24, "evening (18-24)"]] as const;
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
/** Needs a lot of data: 20+ posts on a platform, 3+ in the winning slot, and a clearly better median. Otherwise it stays silent. */
export function bestPostingTime(d: Dataset): { insights: Insight[]; skips: Skipped[] } {
  const insights: Insight[] = [], skips: Skipped[] = [];
  for (const [platform, ps] of by(withData(d.posts), (p) => p.platform)) {
    if (ps.length < 20) { skips.push({ type: "best_posting_time", reason: `${platform}: needs at least 20 posts with data to say anything about timing; found ${ps.length}.` }); continue; }
    const slot = (p: PostPerf) => {
      const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: d.timezone, weekday: "long", hour: "2-digit", hourCycle: "h23" }).formatToParts(new Date(p.publishedAt)).map((x) => [x.type, x.value]));
      const h = Number(parts.hour); return `${parts.weekday} ${BLOCKS.find(([a, b]) => h >= a && h < b)![2]}`;
    };
    const groups = [...by(ps, slot)].map(([s, xs]) => ({ slot: s, n: xs.length, median: median(xs.map((p) => p.interactions))! })).filter((g) => g.n >= 3).sort((a, b) => b.median - a.median);
    const overall = median(ps.map((p) => p.interactions))!;
    const best = groups[0];
    if (!best || overall <= 0 || best.median / overall < 1.3) { skips.push({ type: "best_posting_time", reason: `${platform}: no posting slot stands out (best slot ${best ? `${best.slot}, ${round(best.median / (overall || 1), 2)}x` : "n/a"} the overall median).` }); continue; }
    insights.push({ type: "best_posting_time", severity: "info", title: `Best posting slot on ${cap(platform)}: ${best.slot}`,
      message: `${cap(platform)} posts published on ${best.slot} (${d.timezone}) had a median of ${round(best.median)} interactions vs ${round(overall)} overall (${best.n} posts in that slot, ${ps.length} total).`,
      evidence: { range: d.range, platform, timezone: d.timezone, slot: best.slot, slotPosts: best.n, slotMedian: round(best.median), overallMedian: round(overall), allSlots: groups.slice(0, 5).map((g) => ({ slot: g.slot, posts: g.n, median: round(g.median) })) } });
  }
  return { insights, skips };
}

export const rulesProvider: InsightProvider = (d) => {
  const insights: Insight[] = [], skipped: Skipped[] = [];
  const one = (r: { insight?: Insight; skip?: Skipped }) => { if (r.insight) insights.push(r.insight); if (r.skip) skipped.push(r.skip); };
  const many = (r: { insights: Insight[]; skips: Skipped[] }) => { insights.push(...r.insights); skipped.push(...r.skips); };
  one(bestPlatform(d)); many(formatPerformance(d)); one(engagementChange(d)); one(postingConsistency(d)); many(followerTrend(d)); many(bestPostingTime(d));
  return { insights, skipped };
};

/** Suggestions are only made from insights that cleared their evidence thresholds, and always carry the numbers and a caveat. */
export function recommend(insights: Insight[]): Recommendation[] {
  const out: Recommendation[] = [];
  for (const i of insights) {
    const e = i.evidence as Record<string, any>;
    if (i.type === "format_performance" && e.ratio !== null && e.ratio >= 1.5) out.push({ basedOn: i.type, action: `Publish more ${e.formats[0].format} content on ${e.platform}.`, because: i.message, caveat: "Based on past posts only; try it for a few weeks and compare." });
    if (i.type === "posting_consistency" && i.severity === "warning") out.push({ basedOn: i.type, action: `Aim for at least one post in every week (currently ${e.weeksWithPosts} of ${e.weeks} weeks).`, because: i.message, caveat: "Consistency is associated with steadier growth, but results vary by audience." });
    if (i.type === "best_posting_time") out.push({ basedOn: i.type, action: `Try scheduling ${e.platform} posts for ${e.slot} (${e.timezone}).`, because: i.message, caveat: `Based on ${e.slotPosts} posts in that slot; small samples can mislead.` });
    if (i.type === "best_platform" && i.severity === "positive") out.push({ basedOn: i.type, action: `Consider giving ${e.platforms[0].platform} more of your effort; it earns more interactions per post.`, because: i.message, caveat: e.note });
  }
  return out;
}
