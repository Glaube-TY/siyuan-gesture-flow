export interface NativeAddonCacheResult {
    sourceFound: boolean | null;
    cachePath: string | null;
    cacheReady: boolean;
    error: string | null;
}

/** Copy the bundled binary into an immutable, process-local runtime cache. */
export function prepareNativeAddonCache(
    sourcePath: string,
    pluginsDirectory: string,
    requireNode: (id: string) => unknown,
): NativeAddonCacheResult {
    const result: NativeAddonCacheResult = {
        sourceFound: null, cachePath: null, cacheReady: false, error: null,
    };
    let stage = "source";
    try {
        const fs = requireNode("fs") as typeof import("node:fs");
        const os = requireNode("os") as typeof import("node:os");
        const path = requireNode("path") as typeof import("node:path");
        const crypto = requireNode("crypto") as typeof import("node:crypto");
        const process = requireNode("process") as typeof import("node:process");
        const source = path.resolve(sourcePath);
        result.sourceFound = fs.statSync(source).isFile();
        if (!result.sourceFound) throw new Error("addon source is not a file");
        const bytes = fs.readFileSync(source);
        const hash = (content: Buffer) => crypto.createHash("sha256").update(content).digest("hex");
        const digest = hash(bytes);

        stage = "cache path";
        if (!Number.isSafeInteger(process.pid) || process.pid <= 0) {
            throw new Error("process PID unavailable");
        }
        const plugins = fs.realpathSync(pluginsDirectory);
        const temporaryRoot = fs.realpathSync(os.tmpdir());
        const isWithin = (parent: string, child: string) => {
            const relative = path.relative(parent, child);
            return relative === "" || (!path.isAbsolute(relative) &&
                relative !== ".." && !relative.startsWith(`..${path.sep}`));
        };
        if (isWithin(plugins, temporaryRoot)) {
            throw new Error("temporary directory is inside workspace plugins");
        }
        const namespace = path.join(temporaryRoot, "siyuan-gesture-flow-native");
        const directory = path.join(namespace, String(process.pid));
        // Reject junctions/symlinks before writing outside our cache namespace.
        for (const dir of [namespace, directory]) {
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { mode: 0o700 });
            if (fs.lstatSync(dir).isSymbolicLink() || !fs.statSync(dir).isDirectory() ||
                path.relative(dir, fs.realpathSync(dir)) !== "") {
                throw new Error("cache directory is redirected");
            }
        }
        const target = path.join(directory, `${digest}.node`);
        result.cachePath = target;
        const verify = (file: string) => {
            if (!isWithin(directory, file) || fs.lstatSync(file).isSymbolicLink() ||
                !fs.statSync(file).isFile() || hash(fs.readFileSync(file)) !== digest) {
                throw new Error("cache integrity check failed");
            }
        };

        stage = "cache integrity";
        try {
            fs.lstatSync(target);
            verify(target);
        } catch (err) {
            if ((err as NodeJS.ErrnoException | null)?.code !== "ENOENT") throw err;
            stage = "cache copy";
            const temporary = path.join(directory, `${digest}.${crypto.randomUUID()}.tmp`);
            let created = false;
            try {
                // Exclusive creation avoids touching another writer's temporary file.
                const fd = fs.openSync(temporary, "wx", 0o600);
                created = true;
                try {
                    fs.writeFileSync(fd, bytes);
                } finally {
                    fs.closeSync(fd);
                }
                verify(temporary);
                try {
                    // A hard link publishes complete bytes atomically without replacing a loaded DLL.
                    fs.linkSync(temporary, target);
                } catch (err) {
                    if ((err as NodeJS.ErrnoException | null)?.code !== "EEXIST") throw err;
                }
                verify(target);
            } finally {
                if (created) {
                    try { fs.unlinkSync(temporary); } catch { /* Only our unused temporary file is removed. */ }
                }
            }
        }
        result.cacheReady = true;
    } catch (err) {
        const error = err as NodeJS.ErrnoException | null;
        if (stage === "source" && error?.code === "ENOENT") result.sourceFound = false;
        result.error = `${stage}: ${error?.code ?? error?.message ?? "failed"}`;
    }
    return result;
}
