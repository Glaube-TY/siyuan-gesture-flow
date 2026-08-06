/**
 * Programmatic generator for the GestureFlow plugin icon (160×160 PNG).
 *
 * Draws an abstract gesture-flow motif: a smooth curved trajectory with
 * a direction arrowhead, anti-aliased, on a fully transparent background
 * with a subtle glow so it reads on both light and dark themes.
 *
 * Pure Node (zlib) — no image dependencies.
 *
 * Usage: node scripts/gen-icon.mjs
 */
import fs from "node:fs";
import zlib from "node:zlib";
import path from "node:path";

const W = 160;
const H = 160;

// --- bezier helpers ---------------------------------------------------------
function bez(p0, p1, p2, p3, t) {
    const u = 1 - t;
    return {
        x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
        y: u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y,
    };
}

// Sample the trajectory curve into points.
const PTS = [];
const CURVE = [
    { x: 22, y: 118 }, // start (left-bottom)
    { x: 58, y: 34 },  // control
    { x: 104, y: 122 }, // control
    { x: 138, y: 42 }, // end (right-top)
];
for (let i = 0; i <= 200; i++) {
    PTS.push(bez(CURVE[0], CURVE[1], CURVE[2], CURVE[3], i / 200));
}

// Distance from a point to the polyline.
function distToPath(x, y) {
    let best = Infinity;
    for (let i = 0; i < PTS.length - 1; i++) {
        const a = PTS[i];
        const b = PTS[i + 1];
        const abx = b.x - a.x;
        const aby = b.y - a.y;
        const len2 = abx * abx + aby * aby || 1;
        let t = ((x - a.x) * abx + (y - a.y) * aby) / len2;
        t = Math.max(0, Math.min(1, t));
        const px = a.x + t * abx - x;
        const py = a.y + t * aby - y;
        const d = Math.sqrt(px * px + py * py);
        if (d < best) best = d;
    }
    return best;
}

// Arrowhead at the curve end pointing along the final tangent.
const T0 = PTS[PTS.length - 2];
const T1 = PTS[PTS.length - 1];
const ang = Math.atan2(T1.y - T0.y, T1.x - T0.x);
const ARROW = [
    { x: T1.x, y: T1.y },
    { x: T1.x - 22 * Math.cos(ang - 0.42), y: T1.y - 22 * Math.sin(ang - 0.42) },
    { x: T1.x - 22 * Math.cos(ang + 0.42), y: T1.y - 22 * Math.sin(ang + 0.42) },
];
function inTriangle(px, py, a, b, c) {
    const s = (a.x - c.x) * (py - c.y) - (a.y - c.y) * (px - c.x);
    const t = (b.x - c.x) * (py - c.y) - (b.y - c.y) * (px - c.x);
    const u = (px - c.x) * (a.y - c.y) - (py - c.y) * (a.x - c.x);
    const v = (px - c.x) * (b.y - c.y) - (py - c.y) * (b.x - c.x);
    if ((s <= 0 && t <= 0 && u >= 0 && v >= 0) || (s >= 0 && t >= 0 && u <= 0 && v <= 0)) {
        return true;
    }
    return false;
}

// --- rasterise --------------------------------------------------------------
const LINE_W = 7;
const GLOW_W = 14;
const rgba = Buffer.alloc(W * H * 4);
for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
        const d = distToPath(x + 0.5, y + 0.5);
        const inArrow = inTriangle(x + 0.5, y + 0.5, ARROW[0], ARROW[1], ARROW[2]);
        const dist = Math.min(d, inArrow ? 0 : Infinity);
        const i = (y * W + x) * 4;

        // Glow (soft outer halo, blue).
        let glow = 0;
        if (dist < GLOW_W && !inArrow) {
            glow = Math.max(0, 1 - dist / GLOW_W);
            glow = glow * glow * 0.35;
        }
        // Core stroke.
        let core = 0;
        if (dist < LINE_W) {
            core = 1 - Math.min(1, (dist / LINE_W) * (dist / LINE_W)) * 0.25;
        }
        if (inArrow) core = 1;

        const a = Math.max(0, Math.min(1, core + glow));
        if (a <= 0.004) continue;
        // Blue-violet gesture color that works on light and dark themes.
        const r = 84 + 40 * core;
        const g = 158 + 40 * core;
        const b = 255;
        rgba[i] = Math.round(r);
        rgba[i + 1] = Math.round(g);
        rgba[i + 2] = Math.round(b);
        rgba[i + 3] = Math.round(a * 255);
    }
}

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
ihdr[8] = 8; // bit depth
ihdr[9] = 6; // color type RGBA
ihdr[10] = 0;
ihdr[11] = 0;
ihdr[12] = 0;

// Raw scanlines with filter byte 0.
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

const out = path.join(process.cwd(), "icon.png");
fs.writeFileSync(out, png);
console.log(`wrote ${out} (${png.length} bytes, ${W}x${H})`);
