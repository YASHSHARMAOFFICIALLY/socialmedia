// Absolute base URL for sitemap, robots, canonical links and llms.txt.
// ponytail: falls back to the local dev server; set NEXT_PUBLIC_SITE_URL when there is a domain.
export const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3200").replace(/\/$/, "");

// The backend (Better Auth at /api/auth/*). Session is an httpOnly cookie set by the backend, so every
// call sends credentials. ponytail: defaults to the backend's local wrangler port from .dev.vars.
export const apiUrl = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8799").replace(/\/$/, "");
