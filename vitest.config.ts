import { defineConfig } from "vitest/config";
import { resolve } from "path";

/**
 * Vitest is used ONLY for the small permanent smoke suite under
 * `tests/smoke/` — pure logic (recognition, config migration, shortcut
 * utilities, binding operations).  No browser / DOM simulation: the
 * environment stays `node` and no Svelte or siyuan mocks are needed.
 *
 * Production correctness is enforced by `pnpm check` + `pnpm build` +
 * `pnpm verify` (production-first); real SiYuan manual testing covers
 * UI / pointer / lifecycle behaviour.
 */
export default defineConfig({
    resolve: {
        alias: [
            { find: "@", replacement: resolve(__dirname, "src") },
            // `siyuan` is a type-only package (declarations only) that
            // cannot be resolved at runtime in a node environment.  The
            // stub under tests/stubs supplies the module-level symbols
            // the action bridge imports; it is never exercised by the
            // smoke tests.  Production builds are unaffected.
            { find: "siyuan", replacement: resolve(__dirname, "tests/stubs/siyuan.ts") },
        ],
    },
    test: {
        environment: "node",
        include: ["tests/smoke/**/*.test.ts"],
    },
});
