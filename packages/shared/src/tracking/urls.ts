// Links of online stores (07 §9, 03 §11): which adapter tracks them, their canonical URL and external id. The Worker
// resolves short links first; the agent canonicalizes with the same rules (fixtures/enlaces.json).
import type { Adapter } from './adapters';

export interface CanonicalListing {
  adapter: Adapter;
  canonical_url: string;
  external_id: string | null;
}

/** Short links that only redirect to a product page (03 §11): resolved by their `Location`, never fetched. */
export const SHORT_LINK_HOSTS = new Set(['amzn.to', 'a.co']);

const ASIN = /\/(?:dp|gp\/product|gp\/aw\/d)\/([A-Z0-9]{10})(?:[/?#]|$)/i;
const SAMS = /^\/ip\/([^/]+)\/([0-9A-Za-z]+)\/?$/;
const COSTCO = /^(.*\/p\/([0-9A-Za-z]+))\/?$/;

/** The host without `www.` in lowercase, or null for anything that is not an http(s) URL. */
function parse(raw: string): URL | null {
  try {
    const url = new URL(raw.trim());
    return url.protocol === 'https:' || url.protocol === 'http:' ? url : null;
  } catch {
    return null;
  }
}

const bareHost = (url: URL) => url.hostname.toLowerCase().replace(/^www\./, '');

/** Whether [raw] is a short link to resolve before canonicalizing. */
export function isShortLink(raw: string): boolean {
  const url = parse(raw);
  return url !== null && SHORT_LINK_HOSTS.has(bareHost(url));
}

/**
 * The adapter, canonical URL and id of a product link, or null when no adapter tracks it (Walmart blocks scraping,
 * decision T34) or it is not a product page. The canonical URL drops query and fragment and always uses
 * `https://www.`.
 */
export function canonicalListing(raw: string): CanonicalListing | null {
  const url = parse(raw);
  if (!url) return null;
  const host = bareHost(url);
  let path = url.pathname;
  try {
    path = decodeURI(path);
  } catch {
    // A malformed escape is left as it came.
  }
  if (host === 'amazon.com.mx') {
    const asin = ASIN.exec(path)?.[1]?.toUpperCase();
    return asin
      ? { adapter: 'amazon_mx', canonical_url: `https://www.amazon.com.mx/dp/${asin}`, external_id: asin }
      : null;
  }
  if (host === 'sams.com.mx') {
    const m = SAMS.exec(path);
    return m
      ? {
          adapter: 'sams_mx',
          canonical_url: `https://www.sams.com.mx/ip/${m[1]}/${m[2]}`,
          external_id: m[2]!,
        }
      : null;
  }
  if (host === 'costco.com.mx') {
    const m = COSTCO.exec(path);
    return m
      ? { adapter: 'costco_mx', canonical_url: `https://www.costco.com.mx${m[1]}`, external_id: m[2]! }
      : null;
  }
  return null;
}

/** The first http(s) URL in a shared text ("Mira esto https://… ¡barato!"), without trailing punctuation. */
export function firstUrl(text: string): string | null {
  const match = /https?:\/\/[^\s<>"]+/i.exec(text);
  return match ? match[0].replace(/[),.;:!?¡¿'"\]]+$/, '') : null;
}
