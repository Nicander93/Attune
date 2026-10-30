import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './e2e',
  use: { baseURL: 'http://127.0.0.1:1421', headless: true },
  webServer: {
    // S1 tauri/vite often holds 1420; keep S2 e2e on a free port.
    command: 'npx vite --host 127.0.0.1 --port 1421 --strictPort',
    url: 'http://127.0.0.1:1421',
    reuseExistingServer: !process.env.CI,
  },
  workers: 1,
});
