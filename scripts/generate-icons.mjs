// Generates crisp PNG PWA icons (192x192, 512x512, maskable 512x512) with zero native dependencies.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) {
      c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
    }
  }
  return (c ^ 0xffffffff) >>> 0;
}

function makeChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function encodePNG(width, height, rgba) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    const rowStart = y * (width * 4 + 1);
    raw[rowStart] = 0;
    rgba.copy(raw, rowStart + 1, y * width * 4, (y + 1) * width * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const idat = zlib.deflateSync(raw, { level: 9 });
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([
    sig,
    makeChunk('IHDR', ihdr),
    makeChunk('IDAT', idat),
    makeChunk('IEND', Buffer.alloc(0)),
  ]);
}

function pointInPoly(px, py, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0], yi = poly[i][1];
    const xj = poly[j][0], yj = poly[j][1];
    const intersect = (yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function distToSegment(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  let t = lenSq > 0 ? ((px - x1) * dx + (py - y1) * dy) / lenSq : 0;
  t = Math.max(0, Math.min(1, t));
  const nx = x1 + t * dx;
  const ny = y1 + t * dy;
  return Math.hypot(px - nx, py - ny);
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function renderIcon(size, maskable = false) {
  const rgba = Buffer.alloc(size * size * 4);
  const scale = maskable ? 0.78 : 0.92;
  const map = (x, y) => [
    ((x - 256) * scale + 256) * (size / 512),
    ((y - 256) * scale + 256) * (size / 512),
  ];

  const topPoly = [map(256, 100), map(396, 174), map(256, 248), map(116, 174)];
  const leftPoly = [map(116, 174), map(256, 248), map(256, 400), map(116, 326)];
  const rightPoly = [map(396, 174), map(256, 248), map(256, 400), map(396, 326)];
  const stepPoly = [map(256, 152), map(334, 193), map(256, 234), map(178, 193)];

  const cornerR = maskable ? 0 : size * 0.21;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4;
      const u = x / size;
      const v = y / size;

      // Rounded rect alpha
      let alpha = 255;
      if (cornerR > 0) {
        const cx = x < cornerR ? cornerR : x > size - cornerR ? size - cornerR : x;
        const cy = y < cornerR ? cornerR : y > size - cornerR ? size - cornerR : y;
        const d = Math.hypot(x - cx, y - cy);
        if (d > cornerR) {
          alpha = Math.max(0, Math.round((1 - (d - cornerR)) * 255));
        }
      }

      // Base dark architectural slate gradient
      let r = lerp(15, 30, (u + v) * 0.5);
      let g = lerp(23, 41, (u + v) * 0.5);
      let b = lerp(42, 59, (u + v) * 0.5);

      // Subtle inner glow
      const radial = Math.max(0, 1 - Math.hypot(u - 0.5, v - 0.45) * 1.4);
      r += radial * 18;
      g += radial * 36;
      b += radial * 58;

      if (pointInPoly(x, y, topPoly)) {
        r = lerp(125, 56, u);
        g = lerp(211, 189, u);
        b = lerp(252, 248, u);
        if (pointInPoly(x, y, stepPoly)) {
          r = r * 0.62 + 15 * 0.38;
          g = g * 0.62 + 23 * 0.38;
          b = b * 0.62 + 42 * 0.38;
        }
      } else if (pointInPoly(x, y, leftPoly)) {
        r = lerp(2, 29, v);
        g = lerp(132, 78, v);
        b = lerp(199, 216, v);
      } else if (pointInPoly(x, y, rightPoly)) {
        r = lerp(99, 67, v);
        g = lerp(102, 56, v);
        b = lerp(241, 202, v);
      }

      // Subtle edge highlight along cube center
      const [cx1, cy1] = map(256, 248);
      const [cx2, cy2] = map(256, 400);
      const edgeD = distToSegment(x, y, cx1, cy1, cx2, cy2);
      if (edgeD < size * 0.006) {
        r = lerp(r, 224, 0.5);
        g = lerp(g, 242, 0.5);
        b = lerp(b, 254, 0.5);
      }

      // XR arc accent below cube
      const arcX = (u - 0.5) / (0.32 * scale);
      if (Math.abs(arcX) <= 1) {
        const expectedV = 0.78 + (1 - arcX * arcX) * 0.065 * scale;
        const distArc = Math.abs(v - expectedV) * size;
        const thickness = size * 0.022;
        if (distArc < thickness) {
          const blend = Math.max(0, 1 - distArc / thickness);
          r = lerp(r, 56, blend);
          g = lerp(g, 189, blend);
          b = lerp(b, 248, blend);
        }
      }

      rgba[idx] = Math.min(255, Math.max(0, Math.round(r)));
      rgba[idx + 1] = Math.min(255, Math.max(0, Math.round(g)));
      rgba[idx + 2] = Math.min(255, Math.max(0, Math.round(b)));
      rgba[idx + 3] = alpha;
    }
  }
  return encodePNG(size, size, rgba);
}

const outDir = path.resolve('public/icons');
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'icon-192.png'), renderIcon(192, false));
fs.writeFileSync(path.join(outDir, 'icon-512.png'), renderIcon(512, false));
fs.writeFileSync(path.join(outDir, 'icon-maskable-512.png'), renderIcon(512, true));
console.log('Generated PNG icons in public/icons');
