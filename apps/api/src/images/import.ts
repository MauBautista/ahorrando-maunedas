import { IMPORT_HOSTS, MAX_IMPORT_BYTES } from '@maunedas/shared/api/images';
import { ApiError } from '../errors';
import { mediaType } from './blobs';

const TIMEOUT_MS = 10_000;
const MAX_REDIRECTS = 3;

const hostNotAllowed = () =>
  new ApiError(400, 'VALIDATION_ERROR', {
    reason: 'HOST_NOT_ALLOWED',
    issues: [
      {
        path: ['source_url'],
        code: 'host_not_allowed',
        message: `Hosts permitidos: ${IMPORT_HOSTS.join(', ')}`,
      },
    ],
  });

/** An https URL on an allowed host, without credentials or a custom port; otherwise null. */
export function allowedImportUrl(raw: string, base?: string): URL | null {
  let url: URL;
  try {
    url = new URL(raw, base);
  } catch {
    return null;
  }
  const allowed =
    url.protocol === 'https:' &&
    url.username === '' &&
    url.password === '' &&
    url.port === '' &&
    (IMPORT_HOSTS as readonly string[]).includes(url.hostname);
  return allowed ? url : null;
}

async function readLimited(body: ReadableStream<Uint8Array>, max: number): Promise<Uint8Array | null> {
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

/**
 * Downloads an open catalog photo (10 §2.3): allowed hosts only, also after redirects (followed by hand,
 * at most 3); `image/*`; at most 10 MB, counted while reading even without Content-Length.
 */
export async function fetchCatalogImage(
  fetcher: typeof fetch,
  sourceUrl: string,
  userAgent: string,
): Promise<{ bytes: Uint8Array; contentType: string }> {
  let url = allowedImportUrl(sourceUrl);
  if (!url) throw hostNotAllowed();
  const upstream = () => new ApiError(502, 'UPSTREAM_ERROR', { service: 'open_catalog_image' });

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    let res: Response;
    try {
      res = await fetcher(url.href, {
        redirect: 'manual',
        headers: { 'User-Agent': userAgent },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      throw upstream();
    }
    if (res.status >= 300 && res.status < 400) {
      await res.body?.cancel();
      const location = res.headers.get('Location');
      url = location ? allowedImportUrl(location, url.href) : null;
      if (!url) throw hostNotAllowed();
      continue;
    }
    if (!res.ok || !res.body) {
      await res.body?.cancel();
      throw upstream();
    }
    const contentType = mediaType(res.headers.get('Content-Type'));
    if (!contentType.startsWith('image/')) {
      await res.body.cancel();
      throw new ApiError(415, 'UNSUPPORTED_MEDIA_TYPE');
    }
    if (Number(res.headers.get('Content-Length') ?? 0) > MAX_IMPORT_BYTES) {
      await res.body.cancel();
      throw new ApiError(413, 'PAYLOAD_TOO_LARGE');
    }
    const bytes = await readLimited(res.body, MAX_IMPORT_BYTES);
    if (!bytes) throw new ApiError(413, 'PAYLOAD_TOO_LARGE');
    return { bytes, contentType };
  }
  throw upstream();
}
