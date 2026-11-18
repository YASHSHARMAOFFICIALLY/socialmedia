import { PlatformError } from "./errors.js";
import type { ContentInput } from "./rules.js";

export const PLATFORMS = ["instagram", "x", "linkedin", "youtube", "threads", "facebook", "pinterest", "tiktok", "bluesky", "mastodon", "telegram"] as const;
export type Platform = (typeof PLATFORMS)[number];

/**
 * Flags are TRUE only when the capability is implemented AND verified against the platform's official API docs.
 * Platform access gates (app review, partner approval) are described in docs/integrations.md.
 */
export interface Capabilities {
  textPost: boolean; imagePost: boolean; videoPost: boolean; reel: boolean; carousel: boolean;
  nativeScheduling: boolean; accountAnalytics: boolean; postAnalytics: boolean; engagementMetrics: boolean;
  competitorLookup: boolean;   // can read PUBLIC profile + recent posts of other accounts through the official API
  tokenRefresh: boolean;       // refresh tokens are generally available to self-serve apps
  lookupRecentPosts: boolean;  // can reconcile unknown publish outcomes
}
export const NO_CAPABILITIES: Capabilities = {
  textPost: false, imagePost: false, videoPost: false, reel: false, carousel: false, nativeScheduling: false,
  accountAnalytics: false, postAnalytics: false, engagementMetrics: false, competitorLookup: false, tokenRefresh: false, lookupRecentPosts: false,
};

export interface OAuthTokens { accessToken: string; refreshToken?: string; expiresAt?: Date; refreshExpiresAt?: Date; scopes: string[] }
export interface AccountProfile {
  externalId: string; displayName: string; username?: string; avatarUrl?: string;
  accountType: "personal" | "organization" | "business" | "channel"; metadata?: Record<string, unknown>;
}

export interface ResolvedMedia { id: string; kind: "image" | "video"; role: "media" | "thumbnail"; mimeType: string; sizeBytes: number; storageKey: string; url(): Promise<string> }
export interface PublishInput {
  accessToken: string;
  account: { externalId: string; metadata: Record<string, unknown> };
  content: ContentInput;
  media: ResolvedMedia[];
  /** Stable per job. Use it as the platform-side idempotency/marker where the platform supports one. */
  idempotencyKey: string;
  signal: AbortSignal;
}
export interface PublishResult { externalId: string; url?: string; raw?: unknown; /** Non-fatal problems after the post was created (e.g. a thumbnail was rejected). */ warnings?: string[] }

/** One number as the platform reported it, under the platform's own name. Mapping to canonical keys happens in the analytics normalizer. */
export interface RawMetric { originalName: string; value: number | null; availability: "available" | "unavailable"; period?: "lifetime" | "day" }
export interface MetricsResult { metrics: RawMetric[]; raw: unknown; source: string }
/** Audience distribution of an account (who follows / engages), as the platform reports it. */
export interface AudienceRow { kind: "follower" | "engaged"; breakdown: "age" | "gender" | "city" | "country"; timeframe: string; values: Record<string, number> }
export interface AudienceResult { rows: AudienceRow[]; /** e.g. "follower_demographics_age" -> platform error code (accounts under 100 followers get none) */ unavailable: Record<string, number | null> }
export interface AnalyticsAccountRef { externalId: string; metadata: Record<string, unknown> }

export interface PublicProfile { externalId: string; handle: string; displayName: string; avatarUrl?: string; followers: number | null; posts: number | null; extra?: Record<string, unknown>; uploadsPlaylistId?: string }
export interface PublicPost { externalId: string; publishedAt: Date; url?: string; metrics: Record<string, number | null> }

/** A value the user types when connecting a platform that has no OAuth flow (Bluesky app password, Telegram bot token, ...). */
export interface CredentialField { name: string; label: string; secret: boolean; help?: string }
export interface ConnectedAccount { profile: AccountProfile; tokens: OAuthTokens }

export type ReconcileInput = Pick<PublishInput, "accessToken" | "account" | "content" | "idempotencyKey"> & { since: Date; exclude?: string[] };

export interface SocialAdapter {
  readonly platform: Platform;
  readonly capabilities: Capabilities;
  /** Platforms without OAuth (credentials mode) set this to NO_OAUTH, whose methods throw. */
  readonly oauth: {
    authorizationUrl(p: { state: string; redirectUri: string; codeChallenge?: string }): string;
    exchangeCode(p: { code: string; redirectUri: string; codeVerifier?: string }): Promise<OAuthTokens>;
    /** Present only if the platform supports programmatic refresh for this app. */
    refresh?(refreshToken: string): Promise<OAuthTokens>;
    usesPkce: boolean;
  };
  fetchAccount(accessToken: string): Promise<AccountProfile>;
  /** Credentials-mode connect (no OAuth redirect): validates the fields against the platform and returns the account plus the tokens to store. */
  credentials?: { fields: CredentialField[]; connect(fields: Record<string, string>): Promise<ConnectedAccount> };
  /** OAuth platforms where one authorization grants several accounts (Facebook Pages): overrides fetchAccount in the callback. */
  listAccounts?(tokens: OAuthTokens): Promise<ConnectedAccount[]>;
  /** Present only when publishing is implemented. Errors MUST be PlatformError; a failure after the creating request was sent is kind "unknown". */
  publish?(i: PublishInput): Promise<PublishResult>;
  /** Present only when the platform lets us look up our own recent posts: resolves "unknown" outcomes. Returns null if no matching post exists. */
  /** `since` is the start of the unknown attempt; `exclude` holds external ids already recorded on other jobs of this account. */
  reconcile?(i: ReconcileInput): Promise<PublishResult | null>;
  /** Competitor intelligence: PUBLIC data about another account via the official API, using the workspace's own connected account's token. */
  lookupPublicProfile?(i: { accessToken: string; handle: string }): Promise<PublicProfile>;
  fetchPublicPosts?(i: { accessToken: string; profile: Pick<PublicProfile, "externalId" | "handle" | "uploadsPlaylistId">; limit: number }): Promise<PublicPost[]>;
  /** Present only when the platform exposes metrics for a published post to this app. Metrics the platform did not return MUST be reported as `unavailable`, never as 0. */
  fetchPostMetrics?(i: { accessToken: string; account: AnalyticsAccountRef; externalPostId: string; publishedAt: Date }): Promise<MetricsResult>;
  fetchAccountMetrics?(i: { accessToken: string; account: AnalyticsAccountRef }): Promise<MetricsResult>;
  /** Audience demographics (age/gender/city/country). Absent when the platform offers none to this app. */
  fetchAudience?(i: { accessToken: string; account: AnalyticsAccountRef }): Promise<AudienceResult>;
}

const noOauth = () => { throw new PlatformError("permanent", "This platform connects with credentials, not OAuth"); };
export const NO_OAUTH: SocialAdapter["oauth"] = { usesPkce: false, authorizationUrl: noOauth, exchangeCode: noOauth };
