// Minimal PNG read/write (8-bit RGBA out), enough for small pixel-art sheets.
import zlib from "node:zlib";
import fs from "node:fs";
export function readPng(file) {
  const b = fs.readFileSync(file);
  let p = 8, ihdr, plte, trns; const idat = [];
  while (p < b.length) {
    const len = b.readUInt32BE(p), type = b.toString("latin1", p + 4, p + 8), data = b.subarray(p + 8, p + 8 + len);
    if (type === "IHDR") ihdr = { w: data.readUInt32BE(0), h: data.readUInt32BE(4), depth: data[8], color: data[9], interlace: data[12] };
    if (type === "PLTE") plte = data; if (type === "tRNS") trns = data; if (type === "IDAT") idat.push(data);
    p += 12 + len;
  }
  if (ihdr.interlace) throw new Error("interlaced PNG not supported");
  const ch = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[ihdr.color], bpp = Math.max(1, (ch * ihdr.depth) >> 3);
  const stride = Math.ceil((ihdr.w * ch * ihdr.depth) / 8), raw = zlib.inflateSync(Buffer.concat(idat));
  const px = Buffer.alloc(stride * ihdr.h);
  for (let y = 0; y < ihdr.h; y++) {
    const f = raw[y * (stride + 1)];
    for (let x = 0; x < stride; x++) {
      const v = raw[y * (stride + 1) + 1 + x], a = x >= bpp ? px[y * stride + x - bpp] : 0, u = y ? px[(y - 1) * stride + x] : 0, c = x >= bpp && y ? px[(y - 1) * stride + x - bpp] : 0;
      let pr = 0; if (f === 1) pr = a; else if (f === 2) pr = u; else if (f === 3) pr = (a + u) >> 1; else if (f === 4) { const q = a + u - c, pa = Math.abs(q - a), pb = Math.abs(q - u), pc = Math.abs(q - c); pr = pa <= pb && pa <= pc ? a : pb <= pc ? u : c; }
      px[y * stride + x] = (v + pr) & 255;
    }
  }
  const out = Buffer.alloc(ihdr.w * ihdr.h * 4);
  for (let y = 0; y < ihdr.h; y++) for (let x = 0; x < ihdr.w; x++) {
    const o = (y * ihdr.w + x) * 4; let r, g, bl, al = 255;
    if (ihdr.color === 6) { const i = y * stride + x * 4; [r, g, bl, al] = [px[i], px[i + 1], px[i + 2], px[i + 3]]; }
    else if (ihdr.color === 2) { const i = y * stride + x * 3; [r, g, bl] = [px[i], px[i + 1], px[i + 2]]; }
    else if (ihdr.color === 3) { const bit = x * ihdr.depth, idx = (px[y * stride + (bit >> 3)] >> (8 - ihdr.depth - (bit & 7))) & ((1 << ihdr.depth) - 1); [r, g, bl] = [plte[idx * 3], plte[idx * 3 + 1], plte[idx * 3 + 2]]; al = trns && idx < trns.length ? trns[idx] : 255; }
    else throw new Error("colour type " + ihdr.color + " not supported");
    out[o] = r; out[o + 1] = g; out[o + 2] = bl; out[o + 3] = al;
  }
  return { w: ihdr.w, h: ihdr.h, data: out, info: ihdr };
}
const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (buf) => { let c = 0xffffffff; for (const v of buf) c = crcTable[(c ^ v) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
/**
 * Write an animated PNG that loops forever. `frames` are RGBA buffers of the
 * same size; each is shown for `delayMs`.
 */
export function writeApng(file, w, h, frames, delayMs) {
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, "latin1"), data]);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const control = Buffer.alloc(8);
  control.writeUInt32BE(frames.length, 0); // frame count; play count 0 = forever
  const parts = [Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("acTL", control)];
  let sequence = 0;
  frames.forEach((rgba, index) => {
    const frame = Buffer.alloc(26);
    frame.writeUInt32BE(sequence++, 0);
    frame.writeUInt32BE(w, 4);
    frame.writeUInt32BE(h, 8);
    frame.writeUInt16BE(delayMs, 20); // delay as delayMs / 1000 seconds
    frame.writeUInt16BE(1000, 22);
    parts.push(chunk("fcTL", frame));
    const raw = Buffer.alloc((w * 4 + 1) * h);
    for (let y = 0; y < h; y++) rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
    const data = zlib.deflateSync(raw, { level: 9 });
    if (index === 0) {
      parts.push(chunk("IDAT", data));
    } else {
      const numbered = Buffer.alloc(4);
      numbered.writeUInt32BE(sequence++, 0);
      parts.push(chunk("fdAT", Buffer.concat([numbered, data])));
    }
  });
  parts.push(chunk("IEND", Buffer.alloc(0)));
  fs.writeFileSync(file, Buffer.concat(parts));
}

export function writePng(file, w, h, rgba) {
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type, "latin1"), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  fs.writeFileSync(file, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0))]));
}
