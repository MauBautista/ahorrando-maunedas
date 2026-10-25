import { describe, expect, it } from 'vitest';
import { addTypedTag, emptyProduct, followingMeasure, validateProduct } from './productForm';
import {
  checkCode,
  emptyVariant,
  validateVariant,
  type VariantForm,
  withAmount,
  withBulk,
  withCode,
  withLabel,
  withMeasure,
  withPack,
  withUnit,
} from './variantForm';

const typed = (...steps: Array<(f: VariantForm) => VariantForm>) =>
  steps.reduce((f, step) => step(f), emptyVariant());

/** Android's `VariantForm`/`ProductForm` rules (EditorFormsTest), so both editors save the same rows. */
describe('variant form (S-10)', () => {
  it('suggests the label from the content until someone writes one; clearing it brings it back', () => {
    const f = typed(
      (f) => withPack(f, '6'),
      (f) => withAmount(f, '1'),
      (f) => withUnit(f, 'L'),
    );
    expect(f.label).toBe('6 × 1 L');
    const own = withLabel(f, 'Six pack');
    expect(withAmount(own, '2').label).toBe('Six pack');
    expect(withLabel(withAmount(own, '2'), '').label).toBe('6 × 2 L');
    expect(validateVariant(f).draft).toEqual({
      id: null,
      label: '6 × 1 L',
      measure: 'volume',
      unitAmount: 1000,
      packCount: 6,
      soldByWeight: false,
      codes: [],
    });
  });

  it('sells by weight only by mass, as one kilo in a pack of one', () => {
    expect(withBulk(emptyVariant(), true).bulk).toBe(false);
    const bulk = typed(
      (f) => withMeasure(f, 'mass'),
      (f) => withPack(f, '3'),
      (f) => withBulk(f, true),
    );
    expect(bulk.label).toBe('A granel (kg)');
    expect(validateVariant(bulk).draft).toMatchObject({ unitAmount: 1000, packCount: 1, soldByWeight: true });
    // Leaving mass drops "a granel".
    expect(withMeasure(bulk, 'count').bulk).toBe(false);
  });

  it('says what is missing: pack, amount, whole pieces and the label', () => {
    expect(
      validateVariant(
        typed(
          (f) => withPack(f, '0'),
          (f) => withAmount(f, '1'),
        ),
      ).form.packError,
    ).toBe('Escribe cuántas unidades trae el paquete (1 o más).');
    expect(validateVariant(typed((f) => withAmount(f, 'x'))).form.amountError).toBe(
      'Escribe una cantidad mayor que cero, por ejemplo 1.5',
    );
    expect(
      validateVariant(
        typed(
          (f) => withMeasure(f, 'count'),
          (f) => withAmount(f, '2.5'),
        ),
      ).form.amountError,
    ).toBe('Las piezas van en números enteros.');
    expect(
      validateVariant(
        typed(
          (f) => withAmount(f, '1'),
          (f) => withLabel(f, 'x'.repeat(101)),
        ),
      ).form.labelError,
    ).toBe('Escribe la etiqueta (hasta 100 caracteres).');
  });

  it('keeps codes as digits only, without repeats', () => {
    const f = { ...emptyVariant(), codeInput: '750-1020 515343' };
    const ok = checkCode(f);
    expect(ok).toEqual({ code: '7501020515343' });
    const added = withCode(f, '7501020515343');
    expect([added.codes, added.codeInput]).toEqual([['7501020515343'], '']);
    expect(checkCode({ ...added, codeInput: '7501020515343' })).toEqual({
      error: 'Ese código ya está en la lista.',
    });
    expect(checkCode({ ...added, codeInput: '12345' })).toEqual({
      error: 'Un código tiene de 6 a 14 dígitos.',
    });
  });
});

describe('product form (S-09)', () => {
  it('follows the first variant’s measure until a unit is picked, and reuses a tag of any case', () => {
    const f = followingMeasure(emptyProduct(), 'mass');
    expect(f.displayUnit).toBe('kg');
    expect(followingMeasure({ ...f, displayUnit: '100g', unitChosen: true }, 'volume').displayUnit).toBe(
      '100g',
    );
    const tags = [{ id: 't1', name: 'Básicos' }];
    expect(addTypedTag({ ...f, tagInput: ' básicos ' }, tags)).toMatchObject({
      tagIds: ['t1'],
      newTags: [],
      tagInput: '',
    });
    const fresh = addTypedTag({ ...f, tagInput: 'Lácteos' }, tags);
    expect(addTypedTag({ ...fresh, tagInput: 'LÁCTEOS' }, tags).newTags).toEqual(['Lácteos']);
    expect(validateProduct({ ...f, name: '  ' }).form.nameError).toBe('Escribe el nombre del producto.');
    expect(validateProduct({ ...f, name: ' Leche ', brand: ' ', notes: '' }).draft).toMatchObject({
      name: 'Leche',
      brand: null,
      notes: null,
      categoryId: null,
    });
  });
});
