// Writes the app icons in public/: icon.svg, icon-192.png, icon-512.png, apple-touch-icon.png (180, square: iOS rounds
// it itself) and favicon.ico (16 and 32, PNG inside), all from the shapes below. A dark rounded
// square with a short strip of green bars, like the page's day strip. No image dependency: the PNGs are drawn here and
// encoded with Node's zlib. The output is committed. Run with: node scripts/build-icons.js
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const OUT_DIR = path.join(__dirname, '..', 'public');
const GRID = 512; // shapes are on a 512 grid and scaled to each size
const PNG_SIZES = [192, 512];
const SAMPLES = 4; // per axis, for anti-aliased edges

const BAR_WIDTH = 56;
const BAR_GAP = 16;
const BAR_BOTTOM = 392;
const BARS = [
  { height: 112, fill: '#BBF7D0' },
  { height: 192, fill: '#4ADE80' },
  { height: 264, fill: '#16A34A' },
  { height: 216, fill: '#22C55E' },
  { height: 144, fill: '#86EFAC' }
];
const BARS_LEFT = (GRID - (BARS.length * BAR_WIDTH + (BARS.length - 1) * BAR_GAP)) / 2;

// Back to front.
const SHAPES = [
  { x: 0, y: 0, width: GRID, height: GRID, radius: 112, fill: '#111827' },
  ...BARS.map((bar, index) => ({
    x: BARS_LEFT + index * (BAR_WIDTH + BAR_GAP),
    y: BAR_BOTTOM - bar.height,
    width: BAR_WIDTH,
    height: bar.height,
    radius: 14,
    fill: bar.fill
  }))
];

// The same bars on a square ground, for icons the platform rounds itself.
const SQUARE = [{ ...SHAPES[0], radius: 0 }, ...SHAPES.slice(1)];

function svg() {
  const rects = SHAPES.map(
    ({ x, y, width, height, radius, fill }) =>
      `  <rect x="${x}" y="${y}" width="${width}" height="${height}" rx="${radius}" fill="${fill}"/>`
  );
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${GRID} ${GRID}">\n${rects.join('\n')}\n</svg>\n`;
}

function inside({ x, y, width, height, radius }, px, py) {
  if (px < x || px > x + width || py < y || py > y + height) return false;
  const dx = Math.max(x + radius - px, 0, px - (x + width - radius));
  const dy = Math.max(y + radius - py, 0, py - (y + height - radius));
  return dx * dx + dy * dy <= radius * radius;
}

const rgb = hex => [1, 3, 5].map(start => parseInt(hex.slice(start, start + 2), 16));

// RGBA pixels, each the average of SAMPLES² points coloured by the frontmost shape that holds them.
function draw(size, shapes = SHAPES) {
  const pixels = Buffer.alloc(size * size * 4);
  const colours = shapes.map(shape => rgb(shape.fill));
  const scale = GRID / size;
  for (let row = 0; row < size; row += 1) {
    for (let col = 0; col < size; col += 1) {
      const sum = [0, 0, 0, 0];
      for (let sy = 0; sy < SAMPLES; sy += 1) {
        for (let sx = 0; sx < SAMPLES; sx += 1) {
          const px = (col + (sx + 0.5) / SAMPLES) * scale;
          const py = (row + (sy + 0.5) / SAMPLES) * scale;
          for (let index = shapes.length - 1; index >= 0; index -= 1) {
            if (!inside(shapes[index], px, py)) continue;
            colours[index].forEach((value, channel) => (sum[channel] += value));
            sum[3] += 255;
            break;
          }
        }
      }
      const count = SAMPLES * SAMPLES;
      const covered = sum[3] / 255;
      const offset = (row * size + col) * 4;
      for (let channel = 0; channel < 3; channel += 1) {
        pixels[offset + channel] = covered ? Math.round(sum[channel] / covered) : 0;
      }
      pixels[offset + 3] = Math.round(sum[3] / count);
    }
  }
  return pixels;
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function png(size, shapes = SHAPES) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bits per channel
  header[9] = 6; // RGBA
  const pixels = draw(size, shapes);
  const rows = Buffer.alloc(size * (size * 4 + 1)); // each row starts with filter type 0
  for (let row = 0; row < size; row += 1) {
    pixels.copy(rows, row * (size * 4 + 1) + 1, row * size * 4, (row + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', zlib.deflateSync(rows, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

// An ICO holding PNG images (read by every current browser): a 6-byte header, a 16-byte entry per image, then the PNGs.
function ico(sizes) {
  const images = sizes.map(size => png(size));
  const header = Buffer.alloc(6);
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(images.length, 4);
  let offset = 6 + 16 * images.length;
  const entries = images.map((image, index) => {
    const entry = Buffer.alloc(16);
    entry[0] = sizes[index] % 256; // 0 means 256
    entry[1] = sizes[index] % 256;
    entry.writeUInt16LE(1, 4); // colour planes
    entry.writeUInt16LE(32, 6); // bits per pixel
    entry.writeUInt32LE(image.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += image.length;
    return entry;
  });
  return Buffer.concat([header, ...entries, ...images]);
}

fs.writeFileSync(path.join(OUT_DIR, 'icon.svg'), svg());
PNG_SIZES.forEach(size => fs.writeFileSync(path.join(OUT_DIR, `icon-${size}.png`), png(size)));
fs.writeFileSync(path.join(OUT_DIR, 'apple-touch-icon.png'), png(180, SQUARE));
fs.writeFileSync(path.join(OUT_DIR, 'favicon.ico'), ico([16, 32]));
const written = [...PNG_SIZES.map(size => `icon-${size}.png`), 'apple-touch-icon.png', 'favicon.ico'];
console.log(`Wrote icon.svg and ${written.join(', ')} in public/`);
