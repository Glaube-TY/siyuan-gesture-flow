import { defineConfig } from "vitest/config";
import { resolve } from "path";
import { svelte } from "@sveltejs/vite-plugin-svelte";

export default defineConfig({
    resolve: {
        alias: [
            { find: "@", replacement: resolve(__dirname, "src") },
            // vitest transforms modules in SSR mode, where svelte's
            // package exports resolve "svelte" to its SSR entry (ssr.js)
            // — lifecycle hooks like onMount/onDestroy are no-ops there,
            // so Svelte components would mount without running any
            // lifecycle code.  The alias below pins the exact svelte
            // runtime entries to the browser runtime (see deps.inline).
            {
                find: /^svelte\/internal\/disclose-version$/,
                replacement: resolve(__dirname, "node_modules/svelte/src/runtime/internal/disclose-version/index.js"),
            },
            {
                find: /^svelte\/internal$/,
                replacement: resolve(__dirname, "node_modules/svelte/src/runtime/internal/index.js"),
            },
            {
                find: /^svelte$/,
                replacement: resolve(__dirname, "node_modules/svelte/src/runtime/index.js"),
            },
            // The `siyuan` npm package ships only .d.ts files (no runtime
            // entry).  Alias it to a minimal mock so Vite's import
            // analysis can resolve `import { ... } from "siyuan"`.
            // Individual tests override via `vi.mock("siyuan", ...)`.
            { find: /^siyuan$/, replacement: resolve(__dirname, "test/siyuan-mock.ts") },
        ],
    },
    plugins: [svelte()],
    test: {
        environment: "node",
        include: ["src/**/*.test.ts"],
        server: {
            deps: {
                // Inline the svelte runtime (vitest externalises
                // node_modules by default) so the alias above — which
                // pins svelte to its browser runtime entry — actually
                // applies.  Without this, "svelte" resolves through
                // Node's exports to the SSR entry with no-op lifecycle
                // hooks.
                inline: [/svelte/],
            },
        },
    },
});
