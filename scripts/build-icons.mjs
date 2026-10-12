// Renders src/assets/logo.svg into every raster size the app ships, and packs a
// multi-resolution Windows .ico. Run with: node scripts/build-icons.mjs
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const svg = readFileSync(join(root, 'src/assets/logo.svg'), 'utf8');

const PNG_SIZES = [16, 24, 32, 48, 64, 128, 256, 512];
const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256];

/** Draws the mark at `size` and returns the raw PNG bytes. */
async function drawAt(size) {
  const { chromium } = await import('playwright');
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({
      viewport: { width: size, height: size },
      deviceScaleFactor: 1,
    });
    const page = await context.newPage();
    await page.setContent(
      `<!doctype html><meta charset="utf-8">
       <style>html,body{margin:0;padding:0;background:transparent}
       svg{display:block;width:${size}px;height:${size}px}</style>${svg}`,
    );
    const buffer = await page.screenshot({ omitBackground: true, type: 'png' });
    await context.close();
    return buffer;
  } finally {
    await browser.close();
  }
}

/**
 * Packs PNGs into an ICO. Each image is stored as-is; Windows reads PNG-compressed
 * entries directly, which every supported target since Vista understands.
 */
function packIco(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);

  const entries = images.map(({ size, data }, index) => {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size >= 256 ? 0 : size, 0);
    entry.writeUInt8(size >= 256 ? 0 : size, 1);
    entry.writeUInt8(0, 2);
    entry.writeUInt8(0, 3);
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(data.length, 8);
    entry.writeUInt32LE(header.length + index * 16 + data.length, 12);
    return entry;
  });

  return Buffer.concat([header, ...entries, ...images.map((image) => image.data)]);
}

const pngs = {};
for (const size of PNG_SIZES) pngs[size] = await drawAt(size);

const iconsDir = join(root, 'src-tauri/icons');
mkdirSync(iconsDir, { recursive: true });
for (const size of PNG_SIZES) {
  writeFileSync(join(iconsDir, `${size}x${size}.png`), pngs[size]);
}
writeFileSync(join(iconsDir, '128x128@2x.png'), pngs[256]);
writeFileSync(join(iconsDir, 'icon.png'), pngs[512]);
writeFileSync(
  join(iconsDir, 'icon.ico'),
  packIco(ICO_SIZES.map((size) => ({ size, data: pngs[size] }))),
);

writeFileSync(join(root, 'src/assets/logo.svg'), svg);
console.log(`wrote ${PNG_SIZES.length} PNGs and icon.ico (${ICO_SIZES.join(', ')})`);
