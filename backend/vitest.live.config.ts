import { defineConfig } from "vitest/config";
// Opt-in tests against REAL platform APIs: `npm run test:live`. They need real credentials/tokens (see test/live/README.md) and skip themselves without them.
export default defineConfig({ test: { include: ["test/live/**/*.live.ts"], testTimeout: 120_000, hookTimeout: 120_000 } });
