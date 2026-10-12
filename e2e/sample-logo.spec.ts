import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from '@playwright/test';

// Samples the design draft so the palette comes from the artwork, not from guessing.
test('sample brand colours', async ({ page }) => {
  test.skip(
    !process.env.ATTUNE_LOGO_REFERENCE,
    'Set ATTUNE_LOGO_REFERENCE to a local concept board.',
  );
  const data = readFileSync(resolve(process.env.ATTUNE_LOGO_REFERENCE!)).toString('base64');
  const read = await page.evaluate(async (b64) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(img, 0, 0);
    const { data: pixels } = ctx.getImageData(0, 0, canvas.width, canvas.height);

    const counts = new Map<string, number>();
    const warm = new Map<string, number>();
    const cool = new Map<string, number>();
    const tally = (into: Map<string, number>, r: number, g: number, b: number) => {
      const key = `#${[r, g, b]
        .map((c) => Math.min(255, Math.round(c / 8) * 8))
        .map((c) => c.toString(16).padStart(2, '0'))
        .join('')}`;
      into.set(key, (into.get(key) ?? 0) + 1);
    };
    for (let i = 0; i < pixels.length; i += 4) {
      const [r, g, b, a] = [pixels[i], pixels[i + 1], pixels[i + 2], pixels[i + 3]];
      if (a < 200) continue;
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      // The brand blues and oranges are the only saturated colours on the board.
      if (max - min < 60) continue;
      if (r > b + 40) tally(warm, r, g, b);
      else if (b > r + 40) tally(cool, r, g, b);
    }
    const rank = (m: Map<string, number>) => [...m].sort((a, b) => b[1] - a[1]).slice(0, 5);
    return {
      width: img.width,
      height: img.height,
      orange: rank(warm),
      blue: rank(cool),
      all: [...counts].slice(0, 2),
    };
  }, data);
  console.log(JSON.stringify(read));
});
