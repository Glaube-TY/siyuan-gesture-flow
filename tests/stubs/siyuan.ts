/**
 * Minimal runtime stub for the type-only `siyuan` package.
 *
 * The published `siyuan` package (v1.2.3) ships declarations only — it
 * has no runnable JS entry, so Vitest in a `node` environment cannot
 * resolve it at runtime.  This stub supplies the few module-level
 * symbols the action bridge imports.  Every function throws if ever
 * called; the smoke tests only build the command catalog / registry and
 * never execute a real SiYuan action, so the throws are never reached.
 * Type-checking still resolves the real `siyuan` types (tsconfig.json),
 * so this file never affects production builds.
 */
export function getActiveTab(): never {
    throw new Error("siyuan stub: getActiveTab is not available");
}

export function getActiveEditor(): never {
    throw new Error("siyuan stub: getActiveEditor is not available");
}

export function globalCommand(): never {
    throw new Error("siyuan stub: globalCommand is not available");
}

export const Tab: unknown = undefined;
export const Protyle: unknown = undefined;
