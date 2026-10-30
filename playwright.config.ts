import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './e2e',
  use: { baseURL: 'http://127.0.0.1:1421', headless: true },
  webServer: {
    // Keep e2e on 1421 to avoid tauri/vite holding 1420.
    command: 'npx vite --host 127.0.0.1 --port 1421 --strictPort',
    url: 'http://127.0.0.1:1421',
    reuseExistingServer: !process.env.CI,
  },
  workers: 1,
});
