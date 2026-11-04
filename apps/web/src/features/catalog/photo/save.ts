import type { EditSourceResponse } from '@maunedas/shared/api/images';
import {
  backgroundOf,
  renderEdit,
  THUMB_SIDE,
  type EditParams,
  type Pixels,
} from '@maunedas/shared/images/edit';
import { uuidv7 } from '@maunedas/shared/util/uuid';
import type { Api } from '../../../lib/api';
import { push, touchedAt, type Mutation } from '../../../lib/sync';

/** How the renditions become files; the browser's are in `pixels.ts`. */
export interface Encoders {
  processed(rendered: Pixels): Promise<Blob>;
  thumb(rendered: Pixels, background: string): Promise<Blob>;
  mask(alpha: Uint8Array, width: number, height: number): Promise<Blob>;
}

export const STALE_PHOTO = 'Alguien más cambió esta foto mientras la editabas. Ábrela de nuevo.';

async function pushOrFail(api: Api, mutations: Mutation[]) {
  const res = await push(api, mutations);
  if (res.conflicts.length > 0) throw new Error(STALE_PHOTO);
}

/**
 * "Guardar" (10 §6.2): three renditions `tier='manual'` (mask, processed, thumb), their files, and then the photo
 * selects them with `edit_params.manual`. The rows go first because an upload needs its row (10 §4.1); the
 * selection last, so the photo never points at a file that is not there.
 */
export async function saveEdit(
  api: Api,
  source: Pick<EditSourceResponse, 'image_id' | 'updated_at'>,
  photo: Pixels,
  alpha: Uint8Array,
  params: EditParams,
  encoders: Encoders,
  now = Date.now(),
) {
  const rendered = renderEdit(photo, alpha, params);
  const thumbSize = { width: THUMB_SIDE, height: THUMB_SIDE };
  const files = [
    { kind: 'mask', blob: await encoders.mask(alpha, photo.width, photo.height), size: photo },
    { kind: 'processed', blob: await encoders.processed(rendered), size: rendered },
    { kind: 'thumb', blob: await encoders.thumb(rendered, backgroundOf(params)), size: thumbSize },
  ] as const;
  const renditions = files.map((f) => {
    const id = uuidv7(now);
    const name = `${id}.${f.blob.type === 'image/webp' ? 'webp' : 'png'}`;
    return {
      ...f,
      name,
      row: {
        id,
        image_id: source.image_id,
        kind: f.kind,
        tier: 'manual',
        r2_key: `images/${source.image_id}/${name}`,
        width: f.size.width,
        height: f.size.height,
        bytes: f.blob.size,
        created_at: now,
        updated_at: now,
        deleted_at: null,
      },
    };
  });
  await pushOrFail(
    api,
    renditions.map((r) => ({ table: 'image_renditions', row: r.row })),
  );
  for (const r of renditions) await api.put(`/v1/images/${source.image_id}/blobs/${r.name}`, r.blob);
  const [, processed, thumb] = renditions;
  await pushOrFail(api, [
    {
      table: 'images',
      row: {
        id: source.image_id,
        updated_at: touchedAt(source.updated_at, now),
        selected_processed_id: processed!.row.id,
        selected_thumb_id: thumb!.row.id,
        edit_params: JSON.stringify({ ...params, manual: true }),
      },
    },
  ]);
}

/** "Restablecer" (10 §6.2): back to the newest automatic result, or to the original without one. */
export async function resetEdit(
  api: Api,
  source: Pick<EditSourceResponse, 'image_id' | 'updated_at' | 'automatic'>,
  now = Date.now(),
) {
  await pushOrFail(api, [
    {
      table: 'images',
      row: {
        id: source.image_id,
        updated_at: touchedAt(source.updated_at, now),
        selected_processed_id: source.automatic?.processed_id ?? null,
        selected_thumb_id: source.automatic?.thumb_id ?? null,
        edit_params: null,
      },
    },
  ]);
}
