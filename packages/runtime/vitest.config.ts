import { defineConfig } from "vitest/config";

// The runtime suite spawns metadata workers, child processes and filesystem
// fixtures; full file parallelism overloads the machine and makes timing-
// sensitive tests (process supervisor, migration backups) flaky under AV.
export default defineConfig({
  test: {
    fileParallelism: false,
    testTimeout: 15000,
  },
});
