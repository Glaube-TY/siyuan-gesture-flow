import { resolve } from "path";
import path from "path";
import fs from "fs";
import { defineConfig } from "vite";
import { viteStaticCopy } from "vite-plugin-static-copy";
import livereload from "rollup-plugin-livereload";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import zipPack from "vite-plugin-zip-pack";
import fg from "fast-glob";

import vitePluginYamlI18n from "./yaml-plugin";
import { loadLocalEnvFile } from "./scripts/utils.js";
import { syncDevDeployment } from "./scripts/dev_deploy.js";

loadLocalEnvFile();
const env = process.env;
const isSrcmap = env.VITE_SOURCEMAP === "inline";
const isDev = env.NODE_ENV === "development";
const livereloadClientUrl = env.VITE_LIVERELOAD_CLIENT_URL?.trim() || "";

const outputDir = isDev ? "dev" : "dist";

console.log("isDev=>", isDev);
console.log("isSrcmap=>", isSrcmap);
console.log("outputDir=>", outputDir);

export default defineConfig({
    resolve: {
        alias: {
            "@": resolve(__dirname, "src"),
        }
    },

    plugins: [
        svelte(),

        vitePluginYamlI18n({
            inDir: "public/i18n",
            outDir: `${outputDir}/i18n`
        }),

        viteStaticCopy({
            targets: [
                { src: "./README*.md", dest: "./" },
                { src: "./plugin.json", dest: "./" },
                { src: "./preview.png", dest: "./" },
                { src: "./icon.png", dest: "./" }
            ],
        }),

        copyNativeAddon(outputDir),

        ...(isDev && env.SIYUAN_SKIP_DEV_DEPLOY !== "1" ? [devDeploymentMirror()] : []),
    ],

    define: {
        "process.env.DEV_MODE": JSON.stringify(isDev),
        "process.env.NODE_ENV": JSON.stringify(env.NODE_ENV)
    },

    build: {
        outDir: outputDir,
        emptyOutDir: true,
        minify: true,
        sourcemap: isSrcmap ? "inline" : false,

        lib: {
            entry: resolve(__dirname, "src/index.ts"),
            fileName: () => "index.js",
            formats: ["cjs"],
        },
        rollupOptions: {
            plugins: isDev ? [
                ...(livereloadClientUrl ? [livereload({ watch: outputDir, clientUrl: livereloadClientUrl })] : []),
                watchExternalFiles([
                    "public/i18n/**",
                    "./README*.md",
                    "./plugin.json"
                ])
            ] : [
                cleanupDistFiles({
                    patterns: ["i18n/*.yaml", "i18n/*.md"],
                    distDir: outputDir
                }),
                zipPack({
                    inDir: "./dist",
                    outDir: "./",
                    outFileName: "package.zip"
                })
            ],

            external: ["siyuan", "process"],

            output: {
                entryFileNames: "[name].js",
                assetFileNames: (assetInfo) => {
                    if (assetInfo.name === "style.css") {
                        return "index.css";
                    }
                    return assetInfo.name;
                },
            },
        },
    }
});

function devDeploymentMirror() {
    let missingTargetLogged = false;
    return {
        name: 'dev-real-directory-deployment',
        enforce: 'post' as const,
        apply: 'build' as const,
        writeBundle: {
            sequential: true,
            order: 'post' as const,
            handler() {
                const result = syncDevDeployment();
                if (!result) {
                    if (!missingTargetLogged) {
                        console.log('[dev-deploy] No target configured; run pnpm dev:setup once.');
                        missingTargetLogged = true;
                    }
                    return;
                }
                missingTargetLogged = false;
                console.log(
                    `[dev-deploy] Synced real directory ${result.targetDir} `
                    + `(copied ${result.copied}, unchanged ${result.unchanged}, deleted ${result.deleted})`
                );
            }
        }
    };
}

/**
 * Copy the built native addon (`native/gesture_flow_touchpad.node`) into the
 * output `native/` directory when it exists.  The addon is optional: without
 * it the plugin still works (Electron observer mode).  Build it with
 * `pnpm native:build` on a machine with MSVC + the Windows SDK.
 */
function copyNativeAddon(outputDir: string) {
    const pathMod = path;
    return {
        name: "copy-native-addon",
        apply: "build" as const,
        // writeBundle order "pre" runs BEFORE the dev-deploy mirror's
        // writeBundle ("post"), so dev/native/ is present when stale files
        // are computed (otherwise a locked deployed .node would be treated
        // as stale and fail to unlink).
        writeBundle: {
            sequential: true,
            order: "pre" as const,
            handler() {
                const source = pathMod.resolve(__dirname, "native", "gesture_flow_touchpad.node");
                if (!fs.existsSync(source)) {
                    console.log("[native] no gesture_flow_touchpad.node — skipping (run `pnpm native:build`)");
                    return;
                }
                const targetDir = pathMod.resolve(__dirname, outputDir, "native");
                fs.mkdirSync(targetDir, { recursive: true });
                fs.copyFileSync(source, pathMod.join(targetDir, "gesture_flow_touchpad.node"));
                console.log(`[native] copied gesture_flow_touchpad.node -> ${outputDir}/native/`);
            }
        }
    };
}

function watchExternalFiles(patterns: string[]) {
    return {
        name: "watch-external",
        async buildStart() {
            const files = await fg(patterns);
            for (const file of files) {
                this.addWatchFile(file);
            }
        }
    };
}

/**
 * Clean up some dist files after compiled
 * @author frostime
 * @param options:
 * @returns
 */
function cleanupDistFiles(options: { patterns: string[], distDir: string }) {
    const {
        patterns,
        distDir
    } = options;

    return {
        name: "rollup-plugin-cleanup",
        enforce: "post",
        writeBundle: {
            sequential: true,
            order: "post" as "post",
            async handler() {
                const fg = await import("fast-glob");
                const fs = await import("fs");

                const distPatterns = patterns.map(pat => `${distDir}/${pat}`);
                console.debug("Cleanup searching patterns:", distPatterns);

                const files = await fg.default(distPatterns, {
                    dot: true,
                    absolute: true,
                    onlyFiles: false
                });

                for (const file of files) {
                    try {
                        if (fs.default.existsSync(file)) {
                            const stat = fs.default.statSync(file);
                            if (stat.isDirectory()) {
                                fs.default.rmSync(file, { recursive: true });
                            } else {
                                fs.default.unlinkSync(file);
                            }
                            console.log(`Cleaned up: ${file}`);
                        }
                    } catch (error) {
                        console.error(`Failed to clean up ${file}:`, error);
                    }
                }
            }
        }
    };
}
