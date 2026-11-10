import { defineConfig } from "vitest/config";
// Each test file boots an in-process Postgres (PGlite) and runs all migrations; allow for that under parallel load.
export default defineConfig({ test: { testTimeout: 30_000, hookTimeout: 60_000, include: ["test/**/*.test.ts"] } });
