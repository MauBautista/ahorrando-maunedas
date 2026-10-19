import { exportPKCS8, exportSPKI, generateKeyPair } from 'jose';

/** A throwaway service account with a fresh RSA key (never a real credential). */
export async function createTestServiceAccount() {
  const { publicKey, privateKey } = await generateKeyPair('RS256', { extractable: true });
  const json = JSON.stringify({
    type: 'service_account',
    project_id: 'maunedas-test',
    private_key_id: 'test-key-id',
    private_key: await exportPKCS8(privateKey),
    client_email: 'firebase-adminsdk@maunedas-test.iam.gserviceaccount.com',
  });
  return { json, publicKey, publicPem: await exportSPKI(publicKey) };
}

/** Fake Google token endpoint: records calls and answers with numbered tokens. */
export function fakeTokenEndpoint(options: { status?: number; expiresIn?: number } = {}) {
  const calls: Array<{ url: string; body: URLSearchParams }> = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    calls.push({ url, body: new URLSearchParams(String(init?.body ?? '')) });
    if (options.status && options.status !== 200) {
      return Response.json({ error: 'invalid_grant' }, { status: options.status });
    }
    return Response.json({ access_token: `token-${calls.length}`, expires_in: options.expiresIn ?? 3599 });
  }) as typeof fetch;
  return { fetch: fetchImpl, calls };
}
