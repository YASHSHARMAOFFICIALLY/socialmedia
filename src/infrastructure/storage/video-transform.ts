/**
 * Video transformation port. Production uses Cloudflare Media Transformations: `https://<zone>/cdn-cgi/media/<options>/<source URL>`, which needs
 * transformations enabled on that zone (dashboard > Transformations) and a source that answers HEAD and range requests (R2 presigned URLs do).
 * Documented limits: input under 100 MB and up to 10 minutes; each output is at most 60 seconds, 10 to 2000 px, H.264/AAC MP4.
 * Without it the endpoint answers 503 VIDEO_TRANSFORM_UNAVAILABLE and nothing else is affected.
 */
export interface VideoTransformOptions { width?: number | undefined; height?: number | undefined; fit: "scale-down" | "contain" | "cover"; durationS?: number | undefined; startS?: number | undefined; audio: boolean }
export interface VideoTransformer {
  transform(sourceUrl: string, o: VideoTransformOptions): Promise<{ bytes: Uint8Array; contentType: string }>;
}

export const MEDIA_TRANSFORM_MAX_INPUT_BYTES = 100 * 1024 * 1024;
export const MEDIA_TRANSFORM_MAX_OUTPUT_S = 60;

export function cloudflareVideoTransformer(origin: string, f: typeof fetch = fetch): VideoTransformer {
  const base = origin.replace(/\/+$/, "");
  return {
    async transform(sourceUrl, o) {
      const opts = ["mode=video", `fit=${o.fit}`, `audio=${o.audio}`,
        ...(o.width ? [`width=${o.width}`] : []), ...(o.height ? [`height=${o.height}`] : []),
        ...(o.startS ? [`time=${o.startS}s`] : []), ...(o.durationS ? [`duration=${o.durationS}s`] : [])].join(",");
      const res = await f(`${base}/cdn-cgi/media/${opts}/${sourceUrl}`);
      if (!res.ok) throw new Error(`video transformation responded ${res.status}`);
      const type = res.headers.get("content-type") ?? "";
      if (!type.startsWith("video/")) throw new Error("video transformation did not return a video (is Media Transformations enabled for this zone?)");
      return { bytes: new Uint8Array(await res.arrayBuffer()), contentType: type };
    },
  };
}
