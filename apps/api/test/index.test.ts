import { exports } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';

describe('worker', () => {
  it('answers with ok', async () => {
    const res = await exports.default.fetch(new Request('http://example.com/'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, service: 'maunedas' });
  });
});
