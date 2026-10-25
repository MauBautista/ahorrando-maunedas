import type { PushConflict } from '@maunedas/shared/api/sync';

/** What to tell when a push was not taken whole (04 §3.2). */
export function conflictMessage(conflicts: PushConflict[]): string | null {
  if (conflicts.length === 0) return null;
  const reasons = new Set(
    conflicts.map((c) =>
      c.reason === 'VALIDATION'
        ? ((c.details as { reason?: string } | undefined)?.reason ?? c.reason)
        : c.reason,
    ),
  );
  if (reasons.has('BARCODE_TAKEN'))
    return 'Uno de los códigos ya es de otra presentación; el resto se guardó.';
  if (reasons.has('MEASURE_LOCKED'))
    return 'No se puede cambiar la medida: esta presentación ya tiene compras.';
  if (reasons.has('STALE'))
    return 'Alguien más cambió esto mientras lo editabas; se recargó con sus cambios.';
  if (reasons.has('FORBIDDEN') || reasons.has('ADMIN_DELETE')) return 'Solo un administrador puede borrar.';
  return 'No se pudo guardar todo. Revisa los datos e intenta de nuevo.';
}
