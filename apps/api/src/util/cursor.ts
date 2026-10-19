import { ApiError } from '../errors';

/** Opaque keyset cursor: base64url of a JSON array of the sort values of the last item. */
export function encodeCursor(values: ReadonlyArray<string | number>): string {
  return btoa(JSON.stringify(values)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function decodeCursor(cursor: string, arity: number): Array<string | number> {
  try {
    const json = atob(cursor.replace(/-/g, '+').replace(/_/g, '/'));
    const values: unknown = JSON.parse(json);
    if (
      Array.isArray(values) &&
      values.length === arity &&
      values.every((v) => typeof v === 'string' || typeof v === 'number')
    ) {
      return values;
    }
  } catch {
    // falls through
  }
  throw new ApiError(400, 'VALIDATION_ERROR', {
    issues: [{ path: ['cursor'], code: 'invalid_cursor', message: 'Cursor inválido' }],
  });
}
