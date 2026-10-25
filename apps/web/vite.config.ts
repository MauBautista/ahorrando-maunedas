import { readFileSync } from 'node:fs';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as {
  version: string;
};

// In development the API and the Firebase auth proxy run on the local Worker (SDD 06 §4).
export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: { __APP_VERSION__: JSON.stringify(version) },
  server: {
    proxy: {
      '/v1': 'http://localhost:8787',
      '/__': 'http://localhost:8787',
    },
  },
});
