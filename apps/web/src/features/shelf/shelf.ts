import type { PromoParams, PromoType } from '@maunedas/shared/pricing/promotions';
import { affectsPrice } from '@maunedas/shared/pricing/promotions';
import { shelfEffectiveCents } from '@maunedas/shared/pricing/shelf';
import { uuidv7 } from '@maunedas/shared/util/uuid';
import { encodeParams, promotionText } from '../../lib/promotions';
import { type Mutation, newRow } from '../../lib/sync';

export interface ShelfDraft {
  variantId: string;
  storeId: string;
  branchId: string | null;
  priceCents: number;
  promoType: PromoType | null;
  promoParams: PromoParams;
  /** Whether a reduced photo of the shelf goes with it. */
  photo: boolean;
}

/**
 * The rows of a shelf price (S-13, RF-PRE-01), as Android's `ShelfRepository.save`: a `shelf` observation at [now]
 * with `effective_price_cents` (`shelfEffectiveCents`) and the promotion as it reads; its `promotions` row
 * (`observation_id`, the discount per unit); and the `shelf_photo` image, whose binary goes up after the push.
 */
export function shelfMutations(
  draft: ShelfDraft,
  now = Date.now(),
): { imageId: string | null; mutations: Mutation[] } {
  const type = draft.promoType;
  const params =
    type === 'price_cut' ? { ...draft.promoParams, from_cents: draft.priceCents } : draft.promoParams;
  const effective = type ? shelfEffectiveCents(type, params, draft.priceCents) : null;
  const text = type ? promotionText(type, params).slice(0, 300) : null;
  const imageId = draft.photo ? uuidv7(now) : null;
  const observation = newRow(
    {
      variant_id: draft.variantId,
      store_id: draft.storeId,
      branch_id: draft.branchId,
      source: 'shelf',
      price_cents: draft.priceCents,
      effective_price_cents: effective,
      promo_text: text,
      observed_at: now,
      photo_image_id: imageId,
    },
    now,
  );
  const mutations: Mutation[] = [{ table: 'price_observations', row: observation }];
  if (imageId) {
    mutations.push({
      table: 'images',
      row: {
        id: imageId,
        created_at: now,
        updated_at: now,
        deleted_at: null,
        owner_type: 'observation',
        owner_id: observation.id,
        role: 'shelf_photo',
        source: 'user',
        original_key: `images/${imageId}/original.jpg`,
      },
    });
  }
  if (type) {
    mutations.push({
      table: 'promotions',
      row: newRow(
        {
          purchase_id: null,
          purchase_item_id: null,
          observation_id: observation.id,
          type,
          params: encodeParams(params),
          description: text,
          // Per unit, as the observation's prices.
          discount_cents: effective === null ? 0 : draft.priceCents - effective,
          affects_price: affectsPrice(type) ? 1 : 0,
        },
        now,
      ),
    });
  }
  return { imageId, mutations };
}

const PLACE_KEY = 'maunedas.shelf_place';

/**
 * "Recuerda la última" (S-13): the store and branch of the last shelf price saved in this browser. Android reads it
 * from its own rows; the web keeps no rows, so it is a convenience of each browser and may come back empty.
 */
export function lastPlace(): { storeId: string; branchId: string | null } | null {
  try {
    const saved = JSON.parse(localStorage.getItem(PLACE_KEY) ?? 'null') as {
      storeId?: unknown;
      branchId?: unknown;
    } | null;
    if (!saved || typeof saved.storeId !== 'string') return null;
    return { storeId: saved.storeId, branchId: typeof saved.branchId === 'string' ? saved.branchId : null };
  } catch {
    return null;
  }
}

export function rememberPlace(storeId: string, branchId: string | null) {
  try {
    localStorage.setItem(PLACE_KEY, JSON.stringify({ storeId, branchId }));
  } catch {
    // Without storage the next price just starts without a store.
  }
}
