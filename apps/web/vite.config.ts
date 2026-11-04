import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as {
  version: string;
};

/** The files of public/ as the site serves them ("/icons/icon-192.png"). */
function publicFiles(dir = new URL('./public/', import.meta.url), prefix = '/'): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? publicFiles(new URL(`${entry.name}/`, dir), `${prefix}${entry.name}/`)
      : [`${prefix}${entry.name}`],
  );
}

/**
 * The service worker learns what to keep (T-310, 06 §9): every file of the build and of public/, and a version that
 * changes with them, so a new build installs a new cache. Only `sw.js` is touched.
 */
function precacheManifest(): Plugin {
  return {
    name: 'maunedas-precache',
    apply: 'build',
    generateBundle(_options, bundle) {
      const sw = Object.values(bundle).find((file) => file.type === 'chunk' && file.name === 'sw');
      if (!sw || sw.type !== 'chunk') return;
      // A classic service worker cannot import: anything it shares with the page would break it.
      if (sw.imports.length > 0 || sw.dynamicImports.length > 0) {
        this.error(
          `sw.js no puede importar otros archivos: ${[...sw.imports, ...sw.dynamicImports].join(', ')}`,
        );
      }
      // The page is kept as "/": Cloudflare answers /index.html with a redirect, unusable for a navigation. Vite
      // emits index.html after this hook, so it is named here, not taken from the bundle.
      const files = Object.keys(bundle)
        .filter((name) => name !== sw.fileName && name !== 'index.html' && !name.endsWith('.map'))
        .map((name) => `/${name}`);
      const precache = ['/', ...files, ...publicFiles()].sort();
      const hash = createHash('sha256').update(JSON.stringify(precache));
      for (const file of Object.values(bundle)) {
        if (file === sw) continue;
        hash.update(file.fileName).update(file.type === 'chunk' ? file.code : file.source);
      }
      sw.code = sw.code
        .replaceAll('__PRECACHE__', JSON.stringify(precache))
        .replaceAll('__BUILD__', JSON.stringify(hash.digest('hex').slice(0, 12)));
    },
  };
}

// In development the API and the Firebase auth proxy run on the local Worker (SDD 06 §4).
export default defineConfig({
  plugins: [react(), tailwindcss(), precacheManifest()],
  define: { __APP_VERSION__: JSON.stringify(version) },
  build: {
    rollupOptions: {
      // The service worker is its own entry, served from the root so it covers the whole site.
      input: { index: 'index.html', sw: 'src/sw/sw.ts' },
      output: { entryFileNames: (chunk) => (chunk.name === 'sw' ? 'sw.js' : 'assets/[name]-[hash].js') },
    },
  },
  server: {
    proxy: {
      '/v1': 'http://localhost:8787',
      '/__': 'http://localhost:8787',
    },
  },
});
