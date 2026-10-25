import type { ProductDetailResponse } from '@maunedas/shared/api/catalog';
import type { DisplayUnit, Measure } from '@maunedas/shared/pricing/units';
import { defaultDisplayUnit } from '@maunedas/shared/pricing/units';

/**
 * W-09 as typed, Android's `ProductForm`: the display unit follows the measure of the first variant (kg, L or pz)
 * until someone picks one; tags typed with "alta rápida" stay as names until the product is saved.
 */
export interface ProductForm {
  name: string;
  brand: string;
  categoryId: string;
  tagIds: string[];
  newTags: string[];
  tagInput: string;
  displayUnit: DisplayUnit;
  unitChosen: boolean;
  notes: string;
  nameError: string | null;
}

export const emptyProduct = (measure: Measure = 'volume'): ProductForm => ({
  name: '',
  brand: '',
  categoryId: '',
  tagIds: [],
  newTags: [],
  tagInput: '',
  displayUnit: defaultDisplayUnit(measure),
  unitChosen: false,
  notes: '',
  nameError: null,
});

export function productFormOf(p: ProductDetailResponse['product']): ProductForm {
  return {
    ...emptyProduct(),
    name: p.name,
    brand: p.brand ?? '',
    categoryId: p.category_id ?? '',
    tagIds: p.tags.map((t) => t.id),
    displayUnit: p.display_unit,
    unitChosen: true,
    notes: p.notes ?? '',
  };
}

export const followingMeasure = (f: ProductForm, measure: Measure): ProductForm =>
  f.unitChosen ? f : { ...f, displayUnit: defaultDisplayUnit(measure) };

export const toggleTag = (f: ProductForm, id: string): ProductForm => ({
  ...f,
  tagIds: f.tagIds.includes(id) ? f.tagIds.filter((t) => t !== id) : [...f.tagIds, id],
});

/** An existing tag with that name (any case) is selected; otherwise the name waits to be created. */
export function addTypedTag(f: ProductForm, existing: Array<{ id: string; name: string }>): ProductForm {
  const name = f.tagInput.trim().slice(0, 100);
  if (!name) return { ...f, tagInput: '' };
  const match = existing.find((t) => t.name.trim().toLowerCase() === name.toLowerCase());
  if (match)
    return { ...f, tagIds: f.tagIds.includes(match.id) ? f.tagIds : [...f.tagIds, match.id], tagInput: '' };
  if (f.newTags.some((t) => t.toLowerCase() === name.toLowerCase())) return { ...f, tagInput: '' };
  return { ...f, newTags: [...f.newTags, name], tagInput: '' };
}

export interface ProductDraft {
  name: string;
  brand: string | null;
  categoryId: string | null;
  tagIds: string[];
  newTags: string[];
  displayUnit: DisplayUnit;
  notes: string | null;
}

export function validateProduct(f: ProductForm): { draft: ProductDraft | null; form: ProductForm } {
  const name = f.name.trim();
  if (name.length < 1 || name.length > 200)
    return { draft: null, form: { ...f, nameError: 'Escribe el nombre del producto.' } };
  return {
    draft: {
      name,
      brand: f.brand.trim().slice(0, 200) || null,
      categoryId: f.categoryId || null,
      tagIds: f.tagIds,
      newTags: f.newTags,
      displayUnit: f.displayUnit,
      notes: f.notes.trim().slice(0, 2000) || null,
    },
    form: { ...f, nameError: null },
  };
}
