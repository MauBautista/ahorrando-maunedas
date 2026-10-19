/**
 * Compares the `X-Bootstrap-Token` header with the `BOOTSTRAP_TOKEN` secret in constant time (hashing
 * both first so lengths match). A missing secret never matches.
 */
export async function bootstrapTokenMatches(
  secret: string | undefined,
  given: string | undefined,
): Promise<boolean> {
  if (!secret || !given) return false;
  const digest = (s: string) => crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  const [a, b] = await Promise.all([digest(secret), digest(given)]);
  return crypto.subtle.timingSafeEqual(a, b);
}
