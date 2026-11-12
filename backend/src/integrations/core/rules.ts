import type { Platform } from "./types.js";

export interface MediaInput { kind: "image" | "video"; role: "media" | "thumbnail"; mimeType: string; sizeBytes: number; width?: number | null; height?: number | null; durationMs?: number | null }
/** A variant fully resolved for one destination (inherited fields filled in). */
export interface ContentInput { text: string; title: string | null; description: string | null; hashtags: string[]; media: MediaInput[]; metadata: Record<string, unknown> }
export interface Issue {
  code: string; field: string; message: string;
  /** error blocks publishing. warning = rule is not confirmed by official docs or is advisory. */
  severity: "error" | "warning";
}
export interface ContentRules { platform: Platform; validate(c: ContentInput): Issue[] }

export const chars = (s: string) => [...s].length;
export const bytes = (s: string) => new TextEncoder().encode(s).length;
export const mediaOnly = (c: ContentInput) => c.media.filter((m) => m.role === "media");
export const withHashtags = (c: ContentInput) => [c.text.trim(), ...c.hashtags.map((h) => `#${h.replace(/^#/, "")}`)].filter(Boolean).join(c.text.trim() ? "\n\n" : "");
