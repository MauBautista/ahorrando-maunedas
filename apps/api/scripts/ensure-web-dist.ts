// wrangler.jsonc serves ../web/dist as static assets, and wrangler (dev, types, tests) requires that
// directory to exist. Deploy scripts always build the web first; this only covers local runs and CI
// steps that do not need the real build.
import { existsSync, mkdirSync } from 'node:fs';

const dist = new URL('../../web/dist/', import.meta.url);
if (!existsSync(dist)) mkdirSync(dist, { recursive: true });
