import type { Context } from 'hono';
import type { z } from 'zod';
import { ApiError } from '../errors';

/** Issues in `details.issues` (03 §1.2): Zod paths and messages, never the rejected values. */
function issuesOf(error: z.ZodError) {
  return error.issues.map((i) => ({ path: i.path.map(String), code: i.code, message: i.message }));
}

/** Parses the JSON body with a shared Zod schema → `400 E-VALIDATION_ERROR` when invalid. */
export async function parseJsonBody<S extends z.ZodType>(c: Context, schema: S): Promise<z.infer<S>> {
  return parseJsonText(await c.req.text(), schema);
}

/** Same, for a body already read as text (e.g. after a size check). */
export function parseJsonText<S extends z.ZodType>(text: string, schema: S): z.infer<S> {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new ApiError(400, 'VALIDATION_ERROR', {
      issues: [{ path: [], code: 'invalid_json', message: 'JSON inválido' }],
    });
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw new ApiError(400, 'VALIDATION_ERROR', { issues: issuesOf(parsed.error) });
  return parsed.data;
}

/** Same for a route parameter. */
export function parseParam<S extends z.ZodType>(
  value: string | undefined,
  schema: S,
  name: string,
): z.infer<S> {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new ApiError(400, 'VALIDATION_ERROR', {
      issues: issuesOf(parsed.error).map((i) => ({ ...i, path: [name, ...i.path] })),
    });
  }
  return parsed.data;
}
