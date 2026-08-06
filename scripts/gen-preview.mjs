/**
 * Programmatic placeholder-replacement for preview.png (1024×768).
 *
 * NOTE: this renders a *schematic* settings-window layout (title bar,
 * navigation column, binding rows, buttons) so the shipped preview is no
 * longer a grey placeholder.  It is NOT a real SiYuan screenshot — the
 * release acceptance requires a genuine settings-UI screenshot to be
 * provided before creating the v0.1.0 tag.
 *
 * Pure Node (zlib) — no image dependencies.
 *
 * Usage: node scripts/gen-preview.mjs
 */
import fs from "node:fs";
import zlib from "node:zlib";
import path from "node:path";

const W = 1024;
const H = 768;

const rgba = Buffer.alloc(W * H * 4);
function setPx(x, y, r, g, b, a = 255) {
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    const i = (y * W + x) * 4;
    rgba[i] = r;
    rgba[i + 1] = g;
    rgba[i + 2] = b;
    rgba[i + 3] = a;
}
function fillRect(x0, y0, x1, y1, r, g, b, a = 255) {
    for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) setPx(x, y, r, g, b, a);
    }
}

// Window background (light theme).
fillRect(0, 0, W, H, 246, 248, 252);
// Title bar.
fillRect(0, 0, W, 64, 44, 52, 68);
// Left navigation column.
fillRect(0, 64, 200, H, 235, 239, 246);
// Nav items (inactive + one active).
const NAV = [
    [16, 84, 184, 44],
    [16, 140, 184, 44],
    [16, 196, 184, 44],
    [16, 252, 184, 44],
];
NAV.forEach(([x, y, w, h]) => fillRect(x, y, x + w, y + h, 205, 212, 224));
fillRect(16, 308, 200, 352, 88, 168, 255); // active nav item

// Content area: section title bar.
fillRect(224, 92, 1000, 124, 233, 237, 245);
// Binding rows: direction badges + name bars + shortcut bars.
const ROWS = [
    [140, 148],
    [140, 216],
    [140, 284],
    [140, 352],
    [140, 420],
];
ROWS.forEach(([y, badgeY], idx) => {
    const ry = 148 + idx * 68;
    // row background
    fillRect(224, ry, 1000, ry + 56, 255, 255, 255);
    // direction badge (small square)
    fillRect(232, ry + 14, 256, ry + 42, 88, 168, 255);
    // action name bar
    fillRect(268, ry + 14, 620, ry + 38, 150, 158, 175);
    // secondary shortcut bar (dimmer)
    fillRect(268, ry + 42, 460, ry + 50, 205, 212, 224);
    // type badge on the right
    fillRect(940, ry + 14, 994, ry + 42, 224, 178, 120);
});

// Bottom action buttons.
fillRect(820, 690, 924, 736, 88, 168, 255);
fillRect(936, 690, 1000, 736, 205, 212, 224);

// --- PNG encode -------------------------------------------------------------
function crc32(buf) {
    let c = ~0;
    for (let n = 0; n < buf.length; n++) {
        c ^= buf[n];
        for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
    }
    return ~c >>> 0;
}
function chunk(type, data) {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0);
ihdr.writeUInt32BE(H, 4);
ihdr[8] = 8;
ihdr[9] = 6;
ihdr[10] = 0;
ihdr[11] = 0;
ihdr[12] = 0;

const raw = Buffer.alloc(H * (W * 4 + 1));
for (let y = 0; y < H; y++) {
    raw[y * (W * 4 + 1)] = 0;
    rgba.copy(raw, y * (W * 4 + 1) + 1, y * W * 4, (y + 1) * W * 4);
}

const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
]);

const out = path.join(process.cwd(), "preview.png");
fs.writeFileSync(out, png);
console.log(`wrote ${out} (${png.length} bytes, ${W}x${H})`);
