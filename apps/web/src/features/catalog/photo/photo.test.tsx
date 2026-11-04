import type { ImageRef } from '@maunedas/shared/api/catalog';
import {
  DEFAULT_AI_EDIT_PROMPT,
  type AiEditQuote,
  type EditSourceResponse,
} from '@maunedas/shared/api/images';
import type { Pixels } from '@maunedas/shared/images/edit';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { detail, lookups } from '../../../test/catalog';
import { fakeWorker, renderAt } from '../../../test/render';
import { encodeMask, encodeProcessed, encodeThumb, loadPhoto, thumbFromUrl } from './pixels';
import { STALE_PHOTO } from './save';

// jsdom cannot decode, draw nor encode: the canvas half is replaced, the editing itself runs as is.
vi.mock('./pixels', () => ({
  loadPhoto: vi.fn(),
  encodeProcessed: vi.fn(async () => new Blob([new Uint8Array(30)], { type: 'image/webp' })),
  // A browser without WebP (Safari) gives PNG.
  encodeThumb: vi.fn(async () => new Blob([new Uint8Array(20)], { type: 'image/png' })),
  encodeMask: vi.fn(async () => new Blob([new Uint8Array(10)], { type: 'image/png' })),
  thumbFromUrl: vi.fn(async () => new Blob([new Uint8Array(15)], { type: 'image/webp' })),
}));

const LAZY = { timeout: 5000 };
const W = 40;
const H = 20;

/** A 40 × 20 photo whose mask keeps columns 10..29: the product, cropped with its 8 % margin, is x 8..31. */
function loaded(masked = true) {
  const photo: Pixels = { data: new Uint8ClampedArray(W * H * 4).fill(200), width: W, height: H };
  const alpha = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 10; x < 30; x++) alpha[y * W + x] = 255;
  return { photo, alpha: masked ? alpha : new Uint8Array(W * H).fill(255), masked };
}

const image = (o: Partial<ImageRef> = {}): ImageRef => ({
  image_id: 'img-1',
  thumb_url: null,
  processed_url: null,
  original_url: 'https://x/original.jpg',
  license: null,
  attribution: null,
  updated_at: 5_000,
  enhance_pending: false,
  adopt: null,
  background: '#FFFFFF',
  ...o,
});

const source = (o: Partial<EditSourceResponse> = {}): EditSourceResponse => ({
  image_id: 'img-1',
  updated_at: 5_000,
  original_url: 'https://x/original.jpg',
  edit_params: null,
  mask: { url: 'https://x/mask.png', width: W, height: H },
  automatic: { processed_id: 'auto-p', thumb_id: 'auto-t' },
  ...o,
});

const quote = (o: Partial<AiEditQuote> = {}): AiEditQuote => ({
  available: true,
  reason: null,
  estimate_usd: 0.04,
  spent_usd: 1.2,
  budget_usd: 5,
  ...o,
});

function worker(
  edit: () => unknown = () => source(),
  push: () => unknown = () => ({ applied: 1, skipped: 0, conflicts: [] }),
  photo: ImageRef | null = image(),
  ai: { quote?: () => unknown; edit?: () => unknown } = {},
) {
  return fakeWorker({
    '/v1/lookups': () => lookups,
    '/v1/products/p1': () => ({ ...detail, product: { ...detail.product, image: photo } }),
    '/v1/images/img-1/edit': edit,
    '/v1/ai/image-edit': ai.quote ?? (() => quote({ available: false, reason: 'NOT_CONFIGURED' })),
    '/v1/images/img-1/ai-edit':
      ai.edit ??
      (() =>
        Response.json({ rendition_id: 'ai-1', url: 'https://x/ai.png', cost_usd: 0.039 }, { status: 201 })),
    '/v1/images/img-1/blobs/*': (u) => ({ key: `images/img-1/${u.pathname.split('/').pop()}`, bytes: 1 }),
    '/v1/sync/push': push,
  });
}

type Pushed = { table: string; row: Record<string, unknown> };
const pushes = (w: ReturnType<typeof fakeWorker>) =>
  w.posts.filter((p) => p.path === '/v1/sync/push').map((p) => (p.body as { mutations: Pushed[] }).mutations);

const canvas = () => screen.getByLabelText('Vista previa de la foto');
/** A press, drag and release on the preview, in pixels of the turned photo (the canvas is shown 1:1). */
function drag(from: [number, number], to: [number, number] = from) {
  fireEvent.pointerDown(canvas(), { clientX: from[0], clientY: from[1], pointerId: 1 });
  fireEvent.pointerMove(canvas(), { clientX: to[0], clientY: to[1], pointerId: 1 });
  fireEvent.pointerUp(canvas(), { clientX: to[0], clientY: to[1], pointerId: 1 });
}

async function open(w: ReturnType<typeof fakeWorker>) {
  renderAt('/productos/p1', w.fetchImpl);
  const ui = userEvent.setup();
  await ui.click(await screen.findByRole('link', { name: 'Editar foto' }, LAZY));
  await screen.findByRole('heading', { name: 'Editar foto' }, LAZY);
  return ui;
}

const saved = (
  w: ReturnType<typeof fakeWorker>,
): Record<string, unknown> & { edit_params: Record<string, unknown> } => {
  const row = pushes(w).at(-1)![0]!.row;
  return { ...row, edit_params: JSON.parse(row.edit_params as string) as Record<string, unknown> };
};

beforeEach(() => {
  vi.mocked(loadPhoto).mockResolvedValue(loaded());
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  vi.spyOn(HTMLCanvasElement.prototype, 'getBoundingClientRect').mockImplementation(function (
    this: HTMLCanvasElement,
  ) {
    return { left: 0, top: 0, width: this.width, height: this.height } as DOMRect;
  });
});

afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe('W-08 editor de fotos (10 §6.2, T-301)', () => {
  it('saves the renditions, uploads them, and only then selects them', async () => {
    const w = worker();
    const ui = await open(w);
    expect(loadPhoto).toHaveBeenCalledWith(source());
    await ui.click(screen.getByRole('button', { name: 'Guardar' }));
    await screen.findByRole('heading', { name: detail.product.name }, LAZY);

    const [rows, selection] = pushes(w);
    expect(
      rows!.map((m) => [m.table, m.row.kind, m.row.tier, m.row.width, m.row.height, m.row.bytes]),
    ).toEqual([
      ['image_renditions', 'mask', 'manual', W, H, 10],
      ['image_renditions', 'processed', 'manual', 24, H, 30],
      ['image_renditions', 'thumb', 'manual', 256, 256, 20],
    ]);
    const names = rows!.map((m) => `${m.row.id}.${m.row.kind === 'processed' ? 'webp' : 'png'}`);
    expect(rows!.map((m) => m.row.r2_key)).toEqual(names.map((n) => `images/img-1/${n}`));
    // Uploads between the two pushes, each with its own type.
    const order = w.posts.map((p) => `${p.method} ${p.path}`);
    expect(order).toEqual([
      'POST /v1/sync/push',
      ...names.map((n) => `PUT /v1/images/img-1/blobs/${n}`),
      'POST /v1/sync/push',
    ]);
    expect(w.posts.slice(1, 4).map((p) => (p.body as Blob).type)).toEqual([
      'image/png',
      'image/webp',
      'image/png',
    ]);

    expect(selection).toHaveLength(1);
    expect(saved(w)).toEqual({
      id: 'img-1',
      updated_at: expect.any(Number),
      selected_processed_id: rows![1]!.row.id,
      selected_thumb_id: rows![2]!.row.id,
      // Never edited by hand: it starts cropped to the product.
      edit_params: { rotation: 0, crop: { x: 0.2, y: 0, w: 0.6, h: 1 }, manual: true },
    });
    expect((saved(w).updated_at as number) > 5_000).toBe(true);
    // The thumb goes over the background.
    expect(vi.mocked(encodeThumb).mock.calls[0]![1]).toBe('#FFFFFF');
    expect(vi.mocked(encodeProcessed).mock.calls[0]![0]).toMatchObject({ width: 24, height: H });
  });

  it('turns, sets the background and the adjustments', async () => {
    const w = worker();
    const ui = await open(w);
    await ui.click(screen.getByRole('button', { name: 'Girar a la derecha' }));
    expect(canvas().getAttribute('width')).toBe(String(H));
    await ui.click(screen.getByRole('button', { name: 'Negro' }));
    expect(screen.getByRole('button', { name: 'Negro' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.change(screen.getByLabelText('Brillo'), { target: { value: '0.1' } });
    fireEvent.change(screen.getByLabelText('Contraste'), { target: { value: '-0.2' } });
    await ui.click(screen.getByRole('button', { name: 'Guardar' }));
    await screen.findByRole('heading', { name: detail.product.name }, LAZY);
    const params = saved(w).edit_params;
    expect(params.rotation).toBe(90);
    // The crop turned with the photo: the product's columns are now its rows.
    expect(params.crop).toMatchObject({ x: 0, w: 1, h: 0.6 });
    expect((params.crop as { y: number }).y).toBeCloseTo(0.2);
    expect(params.background).toEqual({ type: 'color', value: '#000000' });
    expect(params.adjust).toEqual({ brightness: 0.1, contrast: -0.2 });
    expect(vi.mocked(encodeThumb).mock.calls[0]![1]).toBe('#000000');
    expect(vi.mocked(encodeProcessed).mock.calls[0]![0]).toMatchObject({ width: H, height: 24 });
  });

  it('turning left is three quarters right, and a custom color is kept upper case', async () => {
    const w = worker();
    const ui = await open(w);
    await ui.click(screen.getByRole('button', { name: 'Girar a la izquierda' }));
    fireEvent.change(screen.getByLabelText('Otro color'), { target: { value: '#12ab34' } });
    await ui.click(screen.getByRole('button', { name: 'Guardar' }));
    await screen.findByRole('heading', { name: detail.product.name }, LAZY);
    expect(saved(w).edit_params).toMatchObject({
      rotation: 270,
      background: { type: 'color', value: '#12AB34' },
    });
  });

  it('draws a crop, ignores a slip, and goes back to the whole photo or the product', async () => {
    const w = worker();
    const ui = await open(w);
    drag([2, 2], [22, 12]);
    drag([2, 2], [6, 6]);
    await ui.click(screen.getByRole('button', { name: 'Guardar' }));
    await screen.findByRole('heading', { name: detail.product.name }, LAZY);
    expect(saved(w).edit_params.crop).toEqual({ x: 0.05, y: 0.1, w: 0.5, h: 0.5 });
  });

  it('the whole photo has no crop; the product one comes back', async () => {
    const w = worker();
    const ui = await open(w);
    await ui.click(screen.getByRole('button', { name: 'Foto completa' }));
    await ui.click(screen.getByRole('button', { name: 'Guardar' }));
    await screen.findByRole('heading', { name: detail.product.name }, LAZY);
    expect(saved(w).edit_params).toEqual({ rotation: 0, manual: true });

    cleanup();
    const again = worker();
    const ui2 = await open(again);
    // Dragged outside the photo, the crop stays inside it.
    drag([-10, -5], [100, 100]);
    await ui2.click(screen.getByRole('button', { name: 'Ajustar al producto' }));
    await ui2.click(screen.getByRole('button', { name: 'Guardar' }));
    await screen.findByRole('heading', { name: detail.product.name }, LAZY);
    expect(saved(again).edit_params.crop).toEqual({ x: 0.2, y: 0, w: 0.6, h: 1 });
  });

  it('erases and restores with the brush, and undoes strokes', async () => {
    const w = worker();
    const ui = await open(w);
    await ui.click(screen.getByRole('button', { name: 'Borrar fondo' }));
    const undo = screen.getByRole('button', { name: 'Deshacer' });
    expect(undo).toHaveProperty('disabled', true);
    fireEvent.change(screen.getByLabelText('Tamaño del pincel'), { target: { value: '4' } });
    // A stroke along the product's top row, and a second one that the undo takes back.
    drag([12, 0], [24, 0]);
    drag([20, 10]);
    expect(undo).toHaveProperty('disabled', false);
    await ui.click(undo);
    await ui.click(screen.getByRole('button', { name: 'Restaurar' }));
    // Restoring past the product brings the background back there.
    drag([2, 19]);
    await ui.click(screen.getByRole('button', { name: 'Guardar' }));
    await screen.findByRole('heading', { name: detail.product.name }, LAZY);
    const [alpha, width, height] = vi.mocked(encodeMask).mock.calls[0]!;
    expect([width, height]).toEqual([W, H]);
    const at = (x: number, y: number) => alpha[y * W + x];
    // The brush is 4 px wide: the stroke reaches 2 px past its ends.
    expect([at(12, 0), at(20, 0), at(26, 0), at(27, 0), at(20, 3)]).toEqual([0, 0, 0, 255, 255]);
    // The undone stroke left the middle as it was.
    expect(at(20, 10)).toBe(255);
    expect([at(2, 19), at(0, 0)]).toEqual([255, 0]);
  });

  it('a photo edited by hand opens with its settings and can go back to the automatic result', async () => {
    const params = { rotation: 180, crop: { x: 0.1, y: 0.1, w: 0.5, h: 0.5 }, manual: true, future: 1 };
    const w = worker(() => source({ edit_params: JSON.stringify(params) }));
    const ui = await open(w);
    await ui.click(screen.getByRole('button', { name: 'Restablecer' }));
    await screen.findByRole('heading', { name: detail.product.name }, LAZY);
    expect(pushes(w)).toEqual([
      [
        {
          table: 'images',
          row: {
            id: 'img-1',
            updated_at: expect.any(Number),
            selected_processed_id: 'auto-p',
            selected_thumb_id: 'auto-t',
            edit_params: null,
          },
        },
      ],
    ]);

    cleanup();
    const again = worker(() => source({ edit_params: JSON.stringify(params), automatic: null }));
    const ui2 = await open(again);
    await ui2.click(screen.getByRole('button', { name: 'Guardar' }));
    await screen.findByRole('heading', { name: detail.product.name }, LAZY);
    // Its own crop, not the product's, and what it does not know is kept.
    expect(saved(again).edit_params).toEqual(params);
  });

  it('without an automatic result, going back shows the original', async () => {
    const w = worker(() => source({ edit_params: '{"manual":true}', automatic: null }));
    const ui = await open(w);
    await ui.click(screen.getByRole('button', { name: 'Restablecer' }));
    await screen.findByRole('heading', { name: detail.product.name }, LAZY);
    expect(pushes(w)[0]![0]!.row).toMatchObject({ selected_processed_id: null, selected_thumb_id: null });
  });

  it('a photo never edited by hand has nothing to go back to', async () => {
    await open(worker());
    expect(screen.queryByRole('button', { name: 'Restablecer' })).toBeNull();
  });

  it('says when someone else changed the photo and stays', async () => {
    const w = worker(undefined, () => ({
      applied: 0,
      skipped: 0,
      conflicts: [{ table: 'images', id: 'img-1', reason: 'STALE' }],
    }));
    const ui = await open(w);
    await ui.click(screen.getByRole('button', { name: 'Guardar' }));
    expect((await screen.findByRole('alert')).textContent).toBe(STALE_PHOTO);
    expect(screen.getByRole('button', { name: 'Guardar' })).toHaveProperty('disabled', false);
    expect(w.posts.filter((p) => p.method === 'PUT')).toEqual([]);
  });

  it('says when the saved mask does not fit the photo', async () => {
    vi.mocked(loadPhoto).mockResolvedValue(loaded(false));
    await open(worker());
    expect(screen.getByText(/La máscara guardada no corresponde/)).toBeTruthy();
  });

  it('cannot open without the original or a photo', async () => {
    renderAt(
      '/productos/p1/foto',
      worker(() =>
        Response.json(
          { error: { code: 'IMAGE_NOT_UPLOADED', message: 'La foto aún se sube.' } },
          { status: 409 },
        ),
      ).fetchImpl,
    );
    expect((await screen.findByRole('alert', undefined, LAZY)).textContent).toBe('La foto aún se sube.');
    expect(screen.getByRole('link', { name: 'Volver al producto' }).getAttribute('href')).toBe(
      '/productos/p1',
    );

    cleanup();
    vi.mocked(loadPhoto).mockRejectedValue(new Error('No se pudo abrir la foto.'));
    renderAt('/productos/p1/foto', worker().fetchImpl);
    await waitFor(() =>
      expect(screen.getAllByRole('alert').at(-1)!.textContent).toBe('No se pudo abrir la foto.'),
    );
  });

  it('a product without a photo has no editor', async () => {
    renderAt('/productos/p1', worker(undefined, undefined, null).fetchImpl);
    await screen.findByRole('heading', { name: detail.product.name }, LAZY);
    expect(screen.queryByRole('link', { name: 'Editar foto' })).toBeNull();
    cleanup();
    renderAt('/productos/p1/foto', worker(undefined, undefined, null).fetchImpl);
    expect((await screen.findByRole('alert', undefined, LAZY)).textContent).toBe(
      'Este producto no tiene foto que editar.',
    );
  });

  describe('"Mejorar con IA" (10 §6.3, T-302)', () => {
    it('does not show while no model is chosen', async () => {
      const w = worker();
      await open(w);
      // Once the quote is in, there is still nothing.
      await waitFor(() => expect(w.requests.some((u) => u.pathname === '/v1/ai/image-edit')).toBe(true));
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(screen.queryByRole('region', { name: 'Mejorar con IA' })).toBeNull();
      expect(screen.queryByRole('button', { name: 'Mejorar con IA' })).toBeNull();
    });

    it('says the cost and the month, asks, and uses the result with a thumb made here', async () => {
      const w = worker(undefined, undefined, undefined, { quote: () => quote() });
      const ui = await open(w);
      await ui.click(await screen.findByRole('button', { name: 'Mejorar con IA' }));
      expect(
        screen.getByText('Costo estimado: USD 0.04. Gastado este mes: USD 1.20 de USD 5.00.'),
      ).toBeTruthy();
      await ui.type(screen.getByLabelText('Qué pedirle (opcional)'), '  Quita el reflejo ');
      await ui.click(screen.getByRole('button', { name: 'Negro' }));
      await ui.click(screen.getByRole('button', { name: 'Confirmar y gastar' }));
      expect((await screen.findByRole('img', { name: 'Foto editada por la IA' })).getAttribute('src')).toBe(
        'https://x/ai.png',
      );
      expect(w.posts.find((p) => p.path === '/v1/images/img-1/ai-edit')!.body).toEqual({
        prompt: 'Quita el reflejo',
        confirm: true,
      });
      expect(screen.getByText('Costó USD 0.039.')).toBeTruthy();
      await ui.click(screen.getByRole('button', { name: 'Usar esta foto' }));
      await screen.findByRole('heading', { name: detail.product.name }, LAZY);

      expect(vi.mocked(thumbFromUrl)).toHaveBeenCalledWith('https://x/ai.png', '#000000');
      const [thumb, selection] = pushes(w).map((mutations) => mutations[0]);
      expect(thumb!.row).toMatchObject({ kind: 'thumb', tier: 'manual', width: 256, height: 256, bytes: 15 });
      expect(thumb!.row.r2_key).toBe(`images/img-1/${thumb!.row.id}.webp`);
      expect(w.posts.filter((p) => p.method === 'PUT').map((p) => p.path)).toEqual([
        `/v1/images/img-1/blobs/${thumb!.row.id}.webp`,
      ]);
      expect(selection!.row).toEqual({
        id: 'img-1',
        updated_at: expect.any(Number),
        selected_processed_id: 'ai-1',
        selected_thumb_id: thumb!.row.id,
        edit_params: JSON.stringify({ background: { type: 'color', value: '#000000' }, manual: true }),
      });
    });

    it('without a prompt the model gets the default one, and the result can be discarded', async () => {
      const w = worker(undefined, undefined, undefined, { quote: () => quote() });
      const ui = await open(w);
      await ui.click(await screen.findByRole('button', { name: 'Mejorar con IA' }));
      expect(screen.getByLabelText('Qué pedirle (opcional)').getAttribute('placeholder')).toBe(
        DEFAULT_AI_EDIT_PROMPT,
      );
      await ui.click(screen.getByRole('button', { name: 'Confirmar y gastar' }));
      await ui.click(await screen.findByRole('button', { name: 'Descartar' }));
      expect(w.posts.find((p) => p.path === '/v1/images/img-1/ai-edit')!.body).toEqual({ confirm: true });
      expect(screen.getByRole('button', { name: 'Mejorar con IA' })).toBeTruthy();
      expect(pushes(w)).toEqual([]);
      await ui.click(screen.getByRole('button', { name: 'Mejorar con IA' }));
      await ui.click(screen.getByRole('button', { name: 'Cancelar' }));
      expect(screen.queryByRole('button', { name: 'Confirmar y gastar' })).toBeNull();
    });

    it('past the budget it cannot be asked, and a failed edit says why', async () => {
      await open(
        worker(undefined, undefined, undefined, {
          quote: () => quote({ available: false, reason: 'BUDGET' }),
        }),
      );
      expect(await screen.findByRole('button', { name: 'Mejorar con IA' })).toHaveProperty('disabled', true);
      expect(screen.getByText('Se alcanzó el tope de gasto en IA de este mes.')).toBeTruthy();
      cleanup();

      const answers = [
        () => Response.json({ error: { code: 'AI_BUDGET_EXCEEDED', message: 'x' } }, { status: 402 }),
        () => Response.json({ error: { code: 'UPSTREAM_ERROR', message: 'x' } }, { status: 502 }),
        () => Response.json({ error: { code: 'AI_UNAVAILABLE', message: 'x' } }, { status: 503 }),
        () => Response.json({ error: { code: 'OTHER', message: 'Otra cosa.' } }, { status: 409 }),
      ];
      const ui = await open(
        worker(undefined, undefined, undefined, { quote: () => quote(), edit: () => answers.shift()!() }),
      );
      await ui.click(await screen.findByRole('button', { name: 'Mejorar con IA' }));
      for (const text of [
        'Se alcanzó el tope de gasto en IA de este mes.',
        'La IA no devolvió una foto que se pueda usar. Intenta de nuevo.',
        'La IA no respondió. Intenta más tarde.',
        'Otra cosa.',
      ]) {
        await ui.click(screen.getByRole('button', { name: 'Confirmar y gastar' }));
        await waitFor(() => expect(screen.getByRole('alert').textContent).toBe(text));
      }
    });
  });
});
