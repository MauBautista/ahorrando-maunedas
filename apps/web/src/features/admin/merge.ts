import { ApiError } from '../../lib/api';

/** What each moved table means to a person, singular and plural. */
const MOVED: Record<string, [string, string]> = {
  variants: ['presentación', 'presentaciones'],
  product_tags: ['etiqueta', 'etiquetas'],
  images: ['foto', 'fotos'],
  barcodes: ['código', 'códigos'],
  purchase_items: ['producto de compra', 'productos de compras'],
  price_observations: ['precio de anaquel o web', 'precios de anaquel o web'],
  listings: ['enlace de tienda en línea', 'enlaces de tiendas en línea'],
  alert_rules: ['alerta', 'alertas'],
  receipt_aliases: ['texto de ticket aprendido', 'textos de ticket aprendidos'],
};

/** "2 códigos, 1 producto de compra y 3 fotos"; null when nothing moves. */
export function movedText(moved: Record<string, number>): string | null {
  const parts = Object.entries(moved)
    .filter(([, n]) => n > 0)
    .map(([table, n]) => {
      const [one, many] = MOVED[table] ?? [table, table];
      return `${n} ${n === 1 ? one : many}`;
    });
  if (parts.length === 0) return null;
  return parts.length === 1 ? parts[0]! : `${parts.slice(0, -1).join(', ')} y ${parts.at(-1)}`;
}

export function mergeProblem(e: unknown): string {
  if (e instanceof ApiError && e.code === 'MERGE_INVALID') {
    const reason = (e.details as { reason?: string } | undefined)?.reason;
    if (reason === 'MEASURE_MISMATCH') return 'No se pueden fusionar presentaciones de distinta medida.';
    if (reason === 'DELETED') return 'Uno de los dos ya se eliminó. Búscalos otra vez.';
    if (reason === 'SAME') return 'Elige dos distintos.';
  }
  if (e instanceof ApiError && e.code === 'FORBIDDEN') return 'Solo el administrador puede fusionar.';
  return e instanceof Error ? e.message : 'No se pudo fusionar. Intenta de nuevo.';
}
