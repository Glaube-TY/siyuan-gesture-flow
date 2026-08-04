import { defineConfig } from "vitest/config";
import { resolve } from "path";

export default defineConfig({
    resolve: {
        alias: {
            "@": resolve(__dirname, "src"),
            // The `siyuan` npm package ships only .d.ts files (no runtime
            // entry).  Alias it to a minimal mock so Vite's import
            // analysis can resolve `import { ... } from "siyuan"`.
            // Individual tests override via `vi.mock("siyuan", ...)`.
            siyuan: resolve(__dirname, "test/siyuan-mock.ts"),
        },
    },
    test: {
        environment: "node",
        include: ["src/**/*.test.ts"],
    },
});
