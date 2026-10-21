import { defineConfig } from "vitest/config";

// Each SQL test file boots its own in-memory Postgres (PGlite, WebAssembly). Running all of them at once can
// run out of memory on a small PC, so run at most two at a time.
export default defineConfig({
  test: { maxWorkers: 2 },
});
