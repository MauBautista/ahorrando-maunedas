import { afterEach, describe, expect, it } from 'vitest';
import { lastPlace, rememberPlace, shelfMutations } from './shelf';

const NOW = 5_000;
const base = {
  variantId: 'v1',
  storeId: 's1',
  branchId: null,
  priceCents: 8_900,
  promoType: null,
  promoParams: {},
  photo: false,
};

afterEach(() => localStorage.clear());

/** Android's `ShelfRepository.save` (T-125, decision T63). */
describe('shelf price rows', () => {
  it('writes a shelf observation now, with no promotion', () => {
    const { imageId, mutations } = shelfMutations(base, NOW);
    expect(imageId).toBeNull();
    expect(mutations).toEqual([
      {
        table: 'price_observations',
        row: {
          id: expect.any(String),
          created_at: NOW,
          updated_at: NOW,
          deleted_at: null,
          variant_id: 'v1',
          store_id: 's1',
          branch_id: null,
          source: 'shelf',
          price_cents: 8_900,
          effective_price_cents: null,
          promo_text: null,
          observed_at: NOW,
          photo_image_id: null,
        },
      },
    ]);
  });

  it('a 2x1 with a photo: one unit at half, its promotion per unit and the shelf photo', () => {
    const { imageId, mutations } = shelfMutations(
      { ...base, promoType: 'nxm', promoParams: { n: 2, m: 1 }, photo: true },
      NOW,
    );
    const [obs, image, promo] = mutations.map((m) => m.row);
    expect(obs).toMatchObject({ effective_price_cents: 4_450, promo_text: '2x1', photo_image_id: imageId });
    expect(image).toEqual({
      id: imageId,
      created_at: NOW,
      updated_at: NOW,
      deleted_at: null,
      owner_type: 'observation',
      owner_id: obs!.id,
      role: 'shelf_photo',
      source: 'user',
      original_key: `images/${imageId}/original.jpg`,
    });
    expect(promo).toMatchObject({
      purchase_id: null,
      purchase_item_id: null,
      observation_id: obs!.id,
      type: 'nxm',
      params: '{"n":2,"m":1}',
      description: '2x1',
      discount_cents: 4_450,
      affects_price: 1,
    });
  });

  it('a price cut starts from the shelf price; MSI changes nothing', () => {
    const cut = shelfMutations(
      { ...base, priceCents: 3_500, promoType: 'price_cut', promoParams: { to_cents: 2_990 } },
      NOW,
    );
    expect(cut.mutations[0]!.row).toMatchObject({
      effective_price_cents: 2_990,
      promo_text: 'Rebaja a $29.90',
    });
    expect(cut.mutations[1]!.row).toMatchObject({
      params: '{"from_cents":3500,"to_cents":2990}',
      discount_cents: 510,
    });
    const msi = shelfMutations({ ...base, promoType: 'msi', promoParams: { months: 12 } }, NOW);
    expect(msi.mutations[0]!.row).toMatchObject({
      effective_price_cents: null,
      promo_text: '12 meses sin intereses',
    });
    expect(msi.mutations[1]!.row).toMatchObject({ discount_cents: 0, affects_price: 0 });
  });

  it('remembers the last store and branch of this browser', () => {
    expect(lastPlace()).toBeNull();
    rememberPlace('s1', 'b1');
    expect(lastPlace()).toEqual({ storeId: 's1', branchId: 'b1' });
    localStorage.setItem('maunedas.shelf_place', '{no');
    expect(lastPlace()).toBeNull();
  });
});
