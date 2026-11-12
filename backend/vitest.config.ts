import { defineConfig } from "vitest/config";
// Each test file boots an in-process Postgres (PGlite) and runs all migrations; allow for that under parallel load.
export default defineConfig({ test: { testTimeout: 120_000, hookTimeout: 120_000, include: ["test/**/*.test.ts"] } });
