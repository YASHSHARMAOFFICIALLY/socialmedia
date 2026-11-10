/**
 * Image transformation port. Production uses Cloudflare Images transformations through Workers fetch (`cf.image`, documented as available on
 * any zone that hosts a Worker); it must be enabled for the zone/account and the source must be an allowed origin. Without it the derivative
 * endpoint answers 503 IMAGE_TRANSFORM_UNAVAILABLE and nothing else is affected.
 */
export interface ImageTransformer {
  transform(sourceUrl: string, o: { format: "jpeg" | "png" | "webp"; width?: number | undefined; height?: number | undefined; fit: "scale-down" | "contain" | "cover"; quality: number }): Promise<{ bytes: Uint8Array; contentType: string }>;
}

export function cloudflareImageTransformer(f: typeof fetch = fetch): ImageTransformer {
  return {
    async transform(sourceUrl, o) {
      const res = await f(sourceUrl, { cf: { image: { format: o.format, fit: o.fit, quality: o.quality, ...(o.width ? { width: o.width } : {}), ...(o.height ? { height: o.height } : {}) } } } as RequestInit);
      if (!res.ok) throw new Error(`image transformation responded ${res.status}`);
      const type = res.headers.get("content-type") ?? "";
      if (!type.startsWith("image/")) throw new Error("image transformation did not return an image (is Images transformation enabled for this zone?)");
      return { bytes: new Uint8Array(await res.arrayBuffer()), contentType: type };
    },
  };
}
