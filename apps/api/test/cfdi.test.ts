import { env } from 'cloudflare:workers';
import type { CfdiImportResponse, CfdiPreviewResponse } from '@maunedas/shared/api/cfdi';
import { normalizeReceiptText } from '@maunedas/shared/receipts/normalize';
import { uuidv7 } from '@maunedas/shared/util/uuid';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { cents, fechaMs, micros, parseCfdi } from '../src/cfdi/parse';
import { CFDI, FISCAL_UUID } from './support/cfdi';
import { alias, product, store, syncHarness, variant, type Mutation } from './support/sync';

let h: Awaited<ReturnType<typeof syncHarness>>;
let fx: Record<string, string>;
let stores: Record<string, Mutation>;

beforeAll(async () => {
  h = await syncHarness();
});

async function call(method: string, path: string, body?: unknown, as: 'admin' | 'member' = 'member') {
  const res = await h.app.request(
    path,
    {
      method,
      headers: {
        'Content-Type': 'application/json',
        'X-Client-Schema': '1',
        Authorization: `Bearer ${h.tokens[as]}`,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    },
    env as never,
  );
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

const preview = (xml = CFDI) => call('POST', '/v1/purchases/cfdi/preview', { xml });
const importIt = (storeId: string, xml = CFDI) =>
  call('POST', '/v1/purchases/cfdi', { xml, store_id: storeId });

beforeEach(async () => {
  await h.reset();
  stores = {
    costco: store({ name: 'Costco', kind: 'both' }),
    walmart: store({ name: 'Walmart', kind: 'both' }),
    sams: store({ name: "Sam's Club", kind: 'both' }),
  };
  const p = product({ name: 'Leche Lala Entera', display_unit: 'L' });
  const v = variant(p.row.id);
  const leche = normalizeReceiptText('LECHE LALA ENTERA 1L');
  expect(
    (
      await h.push(
        [
          ...Object.values(stores),
          p,
          v,
          alias(stores.costco!.row.id as string, v.row.id as string, leche),
          // Another store's alias does not link this invoice's lines.
          alias(
            stores.walmart!.row.id as string,
            v.row.id as string,
            normalizeReceiptText('REFRESCO COLA 2L'),
          ),
        ] as Mutation[],
        'admin',
      )
    ).status,
  ).toBe(200);
  fx = {
    variant: v.row.id as string,
    costco: stores.costco!.row.id as string,
    walmart: stores.walmart!.row.id as string,
    sams: stores.sams!.row.id as string,
  };
});

describe('CFDI reading (T-307, 03 §14)', () => {
  it('keeps each line as paid, taxes in, with the discount carrying its tax', () => {
    const c = parseCfdi(CFDI);
    expect(c.fiscalUuid).toBe(FISCAL_UUID);
    expect(c.emisor).toEqual({ rfc: 'CME910715UB9', name: 'COSTCO DE MEXICO' });
    // 14:23:11 in Mexico City is 20:23:11 UTC.
    expect(c.issuedAt).toBe(Date.UTC(2026, 9, 31, 20, 23, 11));
    expect(c.totalCents).toBe(9040);
    expect(c.lines).toEqual([
      {
        description: 'LECHE LALA ENTERA 1L',
        quantity: 2,
        unitPriceCents: 2450,
        grossCents: 4900,
        discountCents: 0,
        finalCents: 4900,
        sku: '7501020515343',
      },
      // 25.86 − 5.17 + 3.31 = 24.00 paid; the 5.17 discount with its 16 % is 6.00, so gross 30.00.
      {
        description: 'GALLETAS MARIAS & NATAS 500G',
        quantity: 1,
        unitPriceCents: 3000,
        grossCents: 3000,
        discountCents: 600,
        finalCents: 2400,
        sku: null,
      },
      {
        description: 'REFRESCO COLA 2L',
        quantity: 1,
        unitPriceCents: 1740,
        grossCents: 1740,
        discountCents: 0,
        finalCents: 1740,
        sku: null,
      },
    ]);
    expect(c.lines.reduce((a, l) => a + l.finalCents, 0)).toBe(c.totalCents);
  });

  it('takes withheld taxes off what was paid', () => {
    const withheld = CFDI.replace(
      '<cfdi:Traslado Base="15.00" Impuesto="002" TipoFactor="Tasa" TasaOCuota="0.160000" Importe="2.40"/>\n      </cfdi:Traslados>',
      '<cfdi:Traslado Base="15.00" Impuesto="002" TipoFactor="Tasa" TasaOCuota="0.160000" Importe="2.40"/>\n      </cfdi:Traslados><cfdi:Retenciones><cfdi:Retencion Base="15.00" Impuesto="001" TipoFactor="Tasa" TasaOCuota="0.100000" Importe="1.50"/></cfdi:Retenciones>',
    );
    expect(withheld).not.toBe(CFDI);
    // 15.00 + 2.40 − 1.50.
    expect(parseCfdi(withheld).lines[2]!.finalCents).toBe(1590);
  });

  it('counts money in millionths, never in floats', () => {
    expect(micros('24.50')).toBe(24_500_000n);
    expect(micros('0.1234565')).toBe(123_457n);
    expect(micros('7')).toBe(7_000_000n);
    expect([micros('-1'), micros('1e3'), micros(''), micros(undefined)]).toEqual([null, null, null, null]);
    expect([cents(24_994_999n), cents(24_995_000n)]).toEqual([2499, 2500]);
    expect(fechaMs('2026-12-31T23:59:59')).toBe(Date.UTC(2027, 0, 1, 5, 59, 59));
    expect(fechaMs('31/10/2026')).toBeNull();
  });

  it('says why an XML is not an importable invoice', async () => {
    const reason = async (xml: string) => (await preview(xml)).body.error?.details?.reason;
    expect(await reason('hola')).toBe('NOT_XML');
    expect(
      await reason(
        `<!DOCTYPE x [<!ENTITY a "b">]>${CFDI.replace('<?xml version="1.0" encoding="UTF-8"?>', '')}`,
      ),
    ).toBe('NOT_XML');
    expect(await reason('<factura/>')).toBe('NOT_CFDI');
    expect(await reason(CFDI.replace('Version="4.0" Serie', 'Version="2.0" Serie'))).toBe('NOT_CFDI');
    expect(await reason(CFDI.replace('TipoDeComprobante="I"', 'TipoDeComprobante="E"'))).toBe('NOT_INCOME');
    expect(await reason(CFDI.replace('Moneda="MXN"', 'Moneda="USD"'))).toBe('NOT_MXN');
    expect(await reason(CFDI.replace(/<cfdi:Complemento>[\s\S]*<\/cfdi:Complemento>/, ''))).toBe('NO_UUID');
    expect(
      await reason(
        CFDI.replace(/<cfdi:Conceptos>[\s\S]*<\/cfdi:Conceptos>/, '<cfdi:Conceptos></cfdi:Conceptos>'),
      ),
    ).toBe('NO_LINES');
    const one = /<cfdi:Concepto [\s\S]*?<\/cfdi:Concepto>/.exec(CFDI)![0];
    expect(
      await reason(
        CFDI.replace(
          /<cfdi:Conceptos>[\s\S]*<\/cfdi:Conceptos>/,
          `<cfdi:Conceptos>${one.repeat(301)}</cfdi:Conceptos>`,
        ),
      ),
    ).toBe('TOO_MANY_LINES');
    expect(await reason(CFDI.replace('Cantidad="2"', 'Cantidad="0"'))).toBe('NOT_CFDI');
    expect((await preview('hola')).status).toBe(422);
    expect((await call('POST', '/v1/purchases/cfdi/preview', {})).status).toBe(400);
  });
});

describe('POST /v1/purchases/cfdi/preview (T-307, 03 §14)', () => {
  it('suggests the store by the issuer and links what its aliases know', async () => {
    const res = await preview();
    expect(res.status).toBe(200);
    const p = res.body as CfdiPreviewResponse;
    expect([p.fiscal_uuid, p.total_cents, p.store_id, p.imported_purchase_id, p.linked]).toEqual([
      FISCAL_UUID,
      9040,
      fx.costco,
      null,
      1,
    ]);
    expect(p.lines.map((l) => l.variant_id)).toEqual([fx.variant, null, null]);
    // Nothing was written.
    expect((await env.DB.prepare('SELECT count(*) AS n FROM purchases').first<{ n: number }>())!.n).toBe(0);
  });

  it('suggests no store for an issuer of several chains, and by RFC once it always went to one', async () => {
    const walmart = CFDI.replace(
      'Rfc="CME910715UB9" Nombre="COSTCO DE MEXICO"',
      'Rfc="NWM9709244W4" Nombre="NUEVA WAL MART DE MEXICO"',
    );
    expect((await preview(walmart)).body.store_id).toBeNull();
    expect((await importIt(fx.walmart!, walmart)).status).toBe(201);
    const next = walmart.replace(
      '6b9f2a3c-1d4e-4f5a-8b7c-9d0e1f2a3b4c',
      'aaaaaaaa-1d4e-4f5a-8b7c-9d0e1f2a3b4c',
    );
    expect((await preview(next)).body.store_id).toBe(fx.walmart);
    // Once the same RFC also went to Sam's, it suggests none.
    expect((await importIt(fx.sams!, next)).status).toBe(201);
    const third = walmart.replace(
      '6b9f2a3c-1d4e-4f5a-8b7c-9d0e1f2a3b4c',
      'bbbbbbbb-1d4e-4f5a-8b7c-9d0e1f2a3b4c',
    );
    expect((await preview(third)).body.store_id).toBeNull();
  });
});

describe('POST /v1/purchases/cfdi (T-307, 03 §14)', () => {
  it('makes a draft purchase with its lines as paid, linked by alias, once', async () => {
    const before = (await env.DB.prepare(`SELECT value FROM sync_meta WHERE key = 'version'`).first<{
      value: number;
    }>())!.value;
    const res = await importIt(fx.costco!);
    expect(res.status).toBe(201);
    const done = res.body as CfdiImportResponse;
    expect([done.lines, done.linked]).toEqual([3, 1]);
    const purchase = await env.DB.prepare('SELECT * FROM purchases WHERE id = ?1')
      .bind(done.purchase_id)
      .first<Record<string, unknown>>();
    expect(purchase).toMatchObject({
      store_id: fx.costco,
      purchased_at: Date.UTC(2026, 9, 31, 20, 23, 11),
      currency: 'MXN',
      subtotal_cents: 9640,
      discount_cents: 0,
      total_cents: 9040,
      source: 'cfdi',
      status: 'draft',
      notes: `Factura ${FISCAL_UUID} de COSTCO DE MEXICO`,
      version: before + 1,
      deleted_at: null,
    });
    const items = (
      await env.DB.prepare('SELECT * FROM purchase_items WHERE purchase_id = ?1 ORDER BY line_no')
        .bind(done.purchase_id)
        .all<Record<string, unknown>>()
    ).results;
    expect(
      items.map((i) => [
        i.line_no,
        i.variant_id,
        i.raw_text,
        i.quantity,
        i.unit_price_cents,
        i.gross_cents,
        i.discount_cents,
        i.final_cents,
        i.version,
      ]),
    ).toEqual([
      [1, fx.variant, 'LECHE LALA ENTERA 1L', 2, 2450, 4900, 0, 4900, before + 1],
      [2, null, 'GALLETAS MARIAS & NATAS 500G', 1, 3000, 3000, 600, 2400, before + 1],
      [3, null, 'REFRESCO COLA 2L', 1, 1740, 1740, 0, 1740, before + 1],
    ]);
    expect(
      await env.DB.prepare('SELECT fiscal_uuid, store_id, emisor_rfc, emisor_name FROM cfdi_imports').first(),
    ).toEqual({
      fiscal_uuid: FISCAL_UUID,
      store_id: fx.costco,
      emisor_rfc: 'CME910715UB9',
      emisor_name: 'COSTCO DE MEXICO',
    });
    // The household sees it by sync.
    const pulled = await (
      await h.pull({ cursors: {} }, 'member')
    ).json<{ changes: Record<string, Array<{ id: string }>> }>();
    expect(pulled.changes.purchases!.map((p) => p.id)).toContain(done.purchase_id);
    expect(pulled.changes.purchase_items).toHaveLength(3);

    // Twice is 409 with the purchase; the preview says so too.
    const again = await importIt(fx.costco!);
    expect([again.status, again.body.error.code, again.body.error.details]).toEqual([
      409,
      'CFDI_ALREADY_IMPORTED',
      { purchase_id: done.purchase_id },
    ]);
    expect((await preview()).body.imported_purchase_id).toBe(done.purchase_id);
  });

  it('lets an invoice in again once its purchase was deleted', async () => {
    const first = (await importIt(fx.costco!)).body as CfdiImportResponse;
    // As the web deletes: a partial row with a newer updated_at.
    const later = Date.now() + 1000;
    const res = await h.push(
      [{ table: 'purchases', row: { id: first.purchase_id, updated_at: later, deleted_at: later } }],
      'member',
    );
    expect(res.status).toBe(200);
    expect((await res.json<{ applied: number }>()).applied).toBe(1);
    expect((await preview()).body.imported_purchase_id).toBeNull();
    expect((await importIt(fx.costco!)).status).toBe(201);
  });

  it('needs a live store', async () => {
    expect((await importIt(uuidv7())).status).toBe(404);
    expect((await call('POST', '/v1/purchases/cfdi', { xml: CFDI })).status).toBe(400);
    expect((await importIt(fx.costco!, 'hola')).body.error.details).toEqual({ reason: 'NOT_XML' });
  });
});
