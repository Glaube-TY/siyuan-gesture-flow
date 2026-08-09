import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";
import fs from "node:fs";

/**
 * Runs the native FrameAssembler invariant tests (built by `pnpm native:build`
 * as the `frame_assembler_test` node-gyp executable target).
 *
 * Skipped when the native build has not been produced (e.g. a fresh clone
 * without a Windows C++ toolchain) — the C++ sources are covered by the same
 * invariant logic the JS provider re-validates.
 */
const TEST_EXE = path.join(
    process.cwd(),
    "native",
    "touchpad",
    "build",
    "Release",
    "frame_assembler_test.exe",
);

describe("native frame assembler invariant (pure C++ protocol)", () => {
    const run = fs.existsSync(TEST_EXE) ? it : it.skip;
    run("hybrid / parallel / incomplete / duplicate / id-0 invariants", () => {
        const stdout = execFileSync(TEST_EXE, { encoding: "utf8", timeout: 30000 });
        expect(stdout).toMatch(/PASS: \d+ checks/);
    });
});
