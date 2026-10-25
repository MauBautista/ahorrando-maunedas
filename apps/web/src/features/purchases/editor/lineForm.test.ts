import { describe, expect, it } from 'vitest';
import { found, purchase } from '../../../test/purchases';
import { draftOf } from './draft';
import { lineFormOf, newLineForm, previewLine, step, validateLine, withPromo, withVariant } from './lineForm';

const milk = found({ last_unit_cents: 2850 });
const ham = found({
  variant_id: 'v-jamon',
  measure: 'mass',
  sold_by_weight: true,
  display_unit: 'kg',
  last_unit_cents: 3290,
});

/** Android's `LineForm` (S-05), so both editors save the same line. */
describe('line form (S-05)', () => {
  it('starts at one piece at the last price here; a weighed variant asks for kilos', () => {
    const f = withVariant(newLineForm(), milk);
    expect([f.quantity, f.price]).toEqual(['1', '28.50']);
    expect(withVariant({ ...newLineForm(), quantity: '3', price: '30' }, milk)).toMatchObject({
      quantity: '3',
      price: '30',
    });
    expect(withVariant({ ...newLineForm(), quantity: '0.5' }, milk).quantity).toBe('1');
    expect(withVariant(newLineForm(), ham)).toMatchObject({ quantity: '', price: '32.90' });
    expect(step(step(f, 1), -5).quantity).toBe('1');
  });

  it('computes the promotion, or saves a typed discount as "other"', () => {
    const f = { ...withPromo(step(withVariant(newLineForm(), milk), 1), 'nxm'), params: { n: '2', m: '1' } };
    expect(previewLine(f)?.promotion).toEqual({
      id: null,
      type: 'nxm',
      params: { n: 2, m: 1 },
      discountCents: 2850,
      description: null,
    });
    // A price cut starts from the list price.
    const cut = { ...withPromo(f, 'price_cut'), params: { to_cents: '25' } };
    expect(previewLine(cut)?.promotion).toMatchObject({
      params: { from_cents: 2850, to_cents: 2500 },
      discountCents: 700,
    });
    const manual = { ...f, manualDiscount: '10' };
    expect(previewLine(manual, 'pr1')?.promotion).toEqual({
      id: 'pr1',
      type: 'other',
      params: { amount_cents: 1000 },
      discountCents: 1000,
      description: null,
    });
    expect(lineFormOf(previewLine(manual)!)).toMatchObject({
      promoType: 'other',
      manualDiscount: '10.00',
      params: { amount_cents: '10.00' },
    });
  });

  it('says what is missing', () => {
    expect(validateLine(newLineForm()).form.error).toBe('Elige el producto.');
    const f = withVariant(newLineForm(), milk);
    expect(validateLine({ ...f, quantity: '0' }).form.error).toBe('Escribe una cantidad mayor que cero.');
    expect(validateLine({ ...f, quantity: '1.5' }).form.error).toBe('Las piezas van en números enteros.');
    expect(validateLine({ ...withVariant(newLineForm(), ham), quantity: '0.845' }).line?.quantity).toBe(
      0.845,
    );
    expect(validateLine({ ...f, price: '' }).form.error).toBe('Escribe el precio.');
    expect(validateLine(withPromo(f, 'percent')).form.error).toBe('Completa los datos de la promoción.');
    expect(validateLine({ ...withPromo(f, 'percent'), manualDiscount: 'x' }).form.error).toBe(
      'Completa los datos de la promoción.',
    );
  });

  it('reopens a saved line as it was typed, the unlinked one with its ticket text', () => {
    const [two, loose, kilos] = draftOf(purchase).lines;
    expect(lineFormOf(two!)).toMatchObject({
      quantity: '2',
      price: '28.50',
      promoType: 'nxm',
      params: { n: '2', m: '1' },
      manualDiscount: null,
    });
    expect(lineFormOf(kilos!).quantity).toBe('0.845');
    // An unlinked line keeps its decimals and saves without a product.
    expect(validateLine({ ...lineFormOf(loose!), quantity: '1.5' }).line).toMatchObject({
      variant: null,
      rawText: 'ABARR VARIOS',
      quantity: 1.5,
    });
  });
});
