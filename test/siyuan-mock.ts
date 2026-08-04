/**
 * Runtime mock for the `siyuan` package.
 *
 * The real `siyuan` npm package ships only TypeScript declaration
 * files (`.d.ts`) — there is no runtime entry point.  In production
 * the SiYuan host application provides these functions at runtime, but
 * Vitest's Vite-powered import analysis fails to resolve the package
 * because `package.json` has no `main`/`module` field.
 *
 * This file provides minimal runtime stubs so that Vite can resolve
 * the `import { ... } from "siyuan"` statements.  Individual tests
 * override the behaviour via `vi.mock("siyuan", ...)`.
 *
 * See: vitest.config.ts → resolve.alias → "siyuan".
 */

export function getActiveTab(): unknown {
    return null;
}

export function getActiveEditor(): unknown {
    return null;
}
