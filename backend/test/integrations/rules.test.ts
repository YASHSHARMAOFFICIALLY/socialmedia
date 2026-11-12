import { describe, it, expect } from "vitest";
import { contentRules } from "../../src/integrations/rules.js";
import type { ContentInput, MediaInput } from "../../src/integrations/core/rules.js";

const base: ContentInput = { text: "hello", title: null, description: null, hashtags: [], media: [], metadata: {} };
const img = (mime = "image/jpeg"): MediaInput => ({ kind: "image", role: "media", mimeType: mime, sizeBytes: 1000 });
const vid = (): MediaInput => ({ kind: "video", role: "media", mimeType: "video/mp4", sizeBytes: 200_000, durationMs: 10000 });
const codes = (p: keyof typeof contentRules, c: Partial<ContentInput>, sev?: "error" | "warning") =>
  contentRules[p].validate({ ...base, ...c }).filter((i) => !sev || i.severity === sev).map((i) => i.code);

describe("X rules", () => {
  it("accepts 280 chars, rejects 281 (as an error)", () => {
    expect(codes("x", { text: "a".repeat(280) }, "error")).toEqual([]);
    expect(codes("x", { text: "a".repeat(281) }, "error")).toContain("TEXT_TOO_LONG");
  });
  it("counts every URL as 23 characters", () => {
    const url = "https://example.com/" + "p".repeat(100);
    expect(codes("x", { text: `${"a".repeat(250)} ${url}` }, "error")).toEqual([]);
    expect(codes("x", { text: `${"a".repeat(260)} ${url}` }, "error")).toContain("TEXT_TOO_LONG");
  });
  it("longPost opt-in lifts the 280 error", () => {
    expect(codes("x", { text: "a".repeat(1000), metadata: { longPost: true } }, "error")).toEqual([]);
  });
  it("hashtags count toward the limit", () => {
    expect(codes("x", { text: "a".repeat(275), hashtags: ["tagtag"] }, "error")).toContain("TEXT_TOO_LONG");
  });
  it("enforces 4 images, no mixing images with video, one video", () => {
    expect(codes("x", { media: Array(5).fill(img()) }, "error")).toContain("TOO_MANY_IMAGES");
    expect(codes("x", { media: [img(), vid()] }, "error")).toContain("MIXED_MEDIA");
    expect(codes("x", { media: [vid(), vid()] }, "error")).toContain("TOO_MANY_VIDEOS");
    expect(codes("x", { media: [img(), img(), img(), img()] }, "error")).toEqual([]);
  });
  it("enforces documented media size limits", () => {
    expect(codes("x", { media: [{ ...img(), sizeBytes: 6 * 1024 * 1024 }] }, "error")).toContain("IMAGE_TOO_LARGE");
    expect(codes("x", { media: [{ ...img("image/gif"), sizeBytes: 14 * 1024 * 1024 }] }, "error")).toEqual([]);
    expect(codes("x", { media: [{ ...img("image/gif"), sizeBytes: 16 * 1024 * 1024 }] }, "error")).toContain("IMAGE_TOO_LARGE");
    expect(codes("x", { media: [{ ...vid(), durationMs: 25 * 60_000 }] }, "warning")).toContain("VIDEO_DURATION");
  });
  it("requires text or media", () => expect(codes("x", { text: "" }, "error")).toContain("EMPTY"));
});

describe("Instagram rules", () => {
  it("requires media; caption <= 2200 incl. hashtags; <= 30 hashtags", () => {
    expect(codes("instagram", {}, "error")).toContain("MEDIA_REQUIRED");
    expect(codes("instagram", { media: [img()], text: "a".repeat(2201) }, "error")).toContain("CAPTION_TOO_LONG");
    expect(codes("instagram", { media: [img()], text: "a".repeat(2190), hashtags: ["abcdefghijk"] }, "error")).toContain("CAPTION_TOO_LONG");
    expect(codes("instagram", { media: [img()], hashtags: Array.from({ length: 31 }, (_, i) => `t${i}`) }, "error")).toContain("TOO_MANY_HASHTAGS");
    expect(codes("instagram", { media: [img()], hashtags: Array.from({ length: 30 }, (_, i) => `t${i}`) }, "error")).toEqual([]);
  });
  it("JPEG only; carousels up to 20 images; unconfirmed video specs are warnings", () => {
    expect(codes("instagram", { media: [img("image/png")] }, "error")).toContain("IMAGE_FORMAT");
    expect(codes("instagram", { media: Array(21).fill(img()) }, "error")).toContain("TOO_MANY_ITEMS");
    expect(codes("instagram", { media: [img(), vid()] }, "error")).not.toContain("CAROUSEL_IMAGES_ONLY");   // carousels may mix images and videos
    expect(codes("instagram", { media: [vid()] }, "error")).toEqual([]);
    expect(codes("instagram", { media: [vid()] }, "warning")).toContain("VIDEO_SPECS_UNVERIFIED");
  });
});

describe("YouTube rules", () => {
  it("needs exactly one video and a title (<=100 chars, no angle brackets)", () => {
    expect(codes("youtube", { title: "t" }, "error")).toContain("VIDEO_REQUIRED");
    expect(codes("youtube", { media: [vid()] }, "error")).toContain("TITLE_REQUIRED");
    expect(codes("youtube", { media: [vid()], title: "x".repeat(101) }, "error")).toContain("TITLE_TOO_LONG");
    expect(codes("youtube", { media: [vid()], title: "a<b" }, "error")).toContain("TITLE_INVALID_CHARS");
    expect(codes("youtube", { media: [vid()], title: "ok" }, "error")).toEqual([]);
  });
  it("measures the description in BYTES, not characters", () => {
    const eu = "€".repeat(1700); // 1700 chars, 5100 bytes
    expect(codes("youtube", { media: [vid()], title: "ok", description: eu }, "error")).toContain("DESCRIPTION_TOO_LONG");
    expect(codes("youtube", { media: [vid()], title: "ok", description: "€".repeat(1600) }, "error")).toEqual([]);
  });
});

describe("LinkedIn rules", () => {
  it("length limit is only advisory (not in official docs)", () => {
    expect(codes("linkedin", { text: "a".repeat(3500) }, "error")).toEqual([]);
    expect(codes("linkedin", { text: "a".repeat(3500) }, "warning")).toContain("TEXT_LONG_UNVERIFIED");
  });
  it("enforces documented media rules", () => {
    expect(codes("linkedin", { media: [img("image/webp")] }, "error")).toContain("IMAGE_FORMAT");
    expect(codes("linkedin", { media: [img("image/png"), img("image/gif")] }, "error")).toEqual([]);
    expect(codes("linkedin", { media: Array(21).fill(img()) }, "error")).toContain("TOO_MANY_IMAGES");
    expect(codes("linkedin", { media: [vid(), img()] }, "error")).toContain("MIXED_MEDIA");
    expect(codes("linkedin", { media: [{ ...vid(), mimeType: "video/quicktime" }] }, "error")).toContain("VIDEO_FORMAT");
    expect(codes("linkedin", { media: [{ ...vid(), sizeBytes: 600 * 1024 * 1024 }] }, "error")).toContain("VIDEO_TOO_LARGE");
    expect(codes("linkedin", { media: [{ ...vid(), sizeBytes: 5_000_000, durationMs: 2000 }] }, "error")).toContain("VIDEO_DURATION");
    expect(codes("linkedin", { media: [{ ...vid(), sizeBytes: 5_000_000, durationMs: 60_000 }] }, "error")).toEqual([]);
  });
});
