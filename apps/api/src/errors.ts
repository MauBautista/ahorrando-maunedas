import type { Context, ErrorHandler, NotFoundHandler } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { AppEnv } from './env';
import { log } from './util/log';

/** Error codes of SDD 03 §1.2. Clients decide by `code`; `message` is shown to the user. */
export const ERROR_MESSAGES = {
  VALIDATION_ERROR: 'Los datos enviados no son válidos.',
  INVALID_BARCODE: 'El código de barras no es válido.',
  WEAK_PASSWORD: 'La contraseña debe tener al menos 8 caracteres.',
  USERNAME_INVALID:
    'El usuario debe tener de 3 a 32 caracteres: minúsculas, números, punto, guion o guion bajo.',
  UNAUTHENTICATED: 'Inicia sesión para continuar.',
  INVALID_TOKEN: 'Tu sesión expiró. Vuelve a iniciar sesión.',
  INVALID_SIGNATURE: 'El enlace no es válido o ya venció.',
  AI_BUDGET_EXCEEDED: 'Se alcanzó el tope mensual de gasto en IA.',
  USER_NOT_ALLOWED: 'Esta cuenta no está registrada. Pídele al administrador que la agregue.',
  USER_DISABLED: 'Tu acceso está desactivado. Habla con el administrador.',
  FORBIDDEN: 'No tienes permiso para hacer esto.',
  NOT_FOUND: 'No se encontró lo que buscas.',
  USERNAME_TAKEN: 'Ese usuario ya existe.',
  GOOGLE_EMAIL_TAKEN: 'Ese correo de Google ya está asignado a otro usuario.',
  LAST_ADMIN: 'Debe quedar al menos un administrador activo.',
  IMAGE_NOT_FOUND: 'La imagen todavía no está registrada en el servidor.',
  IMAGE_NOT_UPLOADED: 'Falta subir alguna imagen.',
  MERGE_INVALID: 'No se pueden fusionar esos registros.',
  BATCH_REJECTED: 'El servidor rechazó el lote de cambios.',
  ALREADY_BOOTSTRAPPED: 'El sistema ya tiene usuarios.',
  PAYLOAD_TOO_LARGE: 'El archivo o la solicitud es demasiado grande.',
  UNSUPPORTED_MEDIA_TYPE: 'Ese tipo de archivo no está permitido.',
  UNSUPPORTED_URL: 'Esa tienda todavía no se puede seguir.',
  EXTRACTION_FAILED: 'No se pudo leer el ticket.',
  UPGRADE_REQUIRED: 'Actualiza la app para seguir sincronizando.',
  RATE_LIMITED: 'Llegaste al límite de solicitudes por hoy. Intenta más tarde.',
  INTERNAL: 'Ocurrió un error inesperado.',
  UPSTREAM_ERROR: 'Un servicio externo no respondió. Intenta de nuevo.',
  AI_UNAVAILABLE: 'La extracción automática no está disponible por ahora.',
} as const;

export type ErrorCode = keyof typeof ERROR_MESSAGES;

export class ApiError extends Error {
  readonly status: ContentfulStatusCode;
  readonly code: ErrorCode;
  readonly details: unknown;

  constructor(status: ContentfulStatusCode, code: ErrorCode, details?: unknown, message?: string) {
    super(message ?? ERROR_MESSAGES[code]);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

/** Codes for errors raised by Hono itself (body limits, validators…) that are not ApiError. */
const CODE_BY_STATUS: Partial<Record<number, ErrorCode>> = {
  400: 'VALIDATION_ERROR',
  401: 'UNAUTHENTICATED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  413: 'PAYLOAD_TOO_LARGE',
  415: 'UNSUPPORTED_MEDIA_TYPE',
};

/** Response body of SDD 03 §1.1. */
export function errorResponse(c: Context<AppEnv>, error: ApiError): Response {
  return c.json(
    {
      error: {
        code: error.code,
        message: error.message,
        ...(error.details === undefined ? {} : { details: error.details }),
        request_id: c.get('requestId'),
      },
    },
    error.status,
  );
}

export const onError: ErrorHandler<AppEnv> = (err, c) => {
  if (err instanceof ApiError) {
    if (err.status >= 500) log('error', err.message, { request_id: c.get('requestId'), code: err.code });
    return errorResponse(c, err);
  }
  if (err instanceof HTTPException) {
    const code = CODE_BY_STATUS[err.status];
    if (code) return errorResponse(c, new ApiError(err.status, code));
  }
  // Unexpected: full detail goes to the logs only, never to the response body.
  log('error', 'unhandled error', {
    request_id: c.get('requestId'),
    method: c.req.method,
    path: c.req.path,
    error: err instanceof Error ? err.message : String(err),
    stack: err instanceof Error ? err.stack : undefined,
  });
  return errorResponse(c, new ApiError(500, 'INTERNAL'));
};

export const notFound: NotFoundHandler<AppEnv> = (c) => errorResponse(c, new ApiError(404, 'NOT_FOUND'));
