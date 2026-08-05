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
        ],
    },
    test: {
        environment: "node",
        include: ["tests/smoke/**/*.test.ts"],
    },
});
