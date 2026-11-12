/** Small cache port. KV (eventually consistent) in production, an in-isolate Map as a fallback/for tests. A cache failure never fails a request. */
export interface CacheStore {
  get(key: string): Promise<unknown | undefined>;
  put(key: string, value: unknown, ttlS: number): Promise<void>;
}

export function createMemoryCache(max = 500, now: () => number = Date.now): CacheStore {
  const m = new Map<string, { v: unknown; exp: number }>();
  return {
    async get(k) { const e = m.get(k); if (!e) return undefined; if (e.exp < now()) { m.delete(k); return undefined; } return e.v; },
    async put(k, v, ttlS) { if (m.size >= max) m.delete(m.keys().next().value!); m.set(k, { v, exp: now() + ttlS * 1000 }); },
  };
}

export function createKvCache(kv: { get(k: string, t: "json"): Promise<unknown>; put(k: string, v: string, o: { expirationTtl: number }): Promise<void> }): CacheStore {
  return {
    get: async (k) => (await kv.get(k, "json")) ?? undefined,
    put: (k, v, ttlS) => kv.put(k, JSON.stringify(v), { expirationTtl: Math.max(60, ttlS) }), // KV minimum TTL is 60 s
  };
}
