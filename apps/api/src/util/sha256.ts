const enc = new TextEncoder();

/** Lowercase hex SHA-256 of [value]: the only form in which the Worker keeps a bearer token. */
export async function sha256Hex(value: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(value)));
  return [...digest].map((b) => b.toString(16).padStart(2, '0')).join('');
}
