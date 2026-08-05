import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// Pure-helper unit tests (lib/**/*.test.ts). The `@` alias mirrors tsconfig paths
// so imports like `@/lib/data/etp-calc` resolve when running under Vitest.
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["lib/**/*.test.ts"],
  },
});
