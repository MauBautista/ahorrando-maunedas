import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// In development the API and the Firebase auth proxy run on the local Worker (SDD 06 §4).
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/v1': 'http://localhost:8787',
      '/__': 'http://localhost:8787',
    },
  },
});
