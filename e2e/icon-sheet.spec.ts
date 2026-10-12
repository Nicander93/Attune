import { test } from '@playwright/test';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';

// The mark must stay readable at 16px, so the sheet shows each size at 1x, 2x and 8x.
test('icon sheet', async ({ page }) => {
  const dir = resolve(process.cwd(), 'src-tauri/icons');
  const sizes = [16, 24, 32, 48, 64, 128, 256];
  const cells = sizes
    .map((size) => {
      const src = readFileSync(resolve(dir, `${size}x${size}.png`)).toString('base64');
      return `<figure>
        <img src="data:image/png;base64,${src}" width="${size}" height="${size}">
        <img src="data:image/png;base64,${src}" width="${size * 4}" height="${size * 4}">
        <figcaption>${size}</figcaption>
      </figure>`;
    })
    .join('');
  await page.setViewportSize({ width: 1400, height: 620 });
  await page.setContent(
    `<style>
      body{margin:0;background:#f4f6f3;font:13px system-ui;color:#26332c;padding:24px}
      .row{display:flex;align-items:flex-end;gap:28px;flex-wrap:wrap}
      figure{margin:0;display:flex;align-items:flex-end;gap:8px}
      figcaption{color:#718179}
    </style><div class="row">${cells}</div>`,
  );
  await page.screenshot({ path: resolve(process.cwd(), 'screenshots', 'icons.png') });
});
