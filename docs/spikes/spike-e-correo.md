# Spike E · Correo sintético en Firebase (T-014)

**Fecha:** 2026-10-21 · **Decide:** D9 · **Resultado:** `maunedas.local` (decisión T47).

## Método

- Script `apps/web/scripts/spike-e.ts` (se puede repetir, por ejemplo en prod): por cada dominio levanta un `wrangler dev --env dev` local con D1 local y la cuenta de servicio de `maunedas-dev` en `apps/api/.dev.vars`; nada desplegado.
- Usa el código real del Worker: `POST /v1/bootstrap` (alta en Firebase por Identity Toolkit con el correo sintético), `GET /v1/me`, `POST /v1/admin/users`, `PATCH /v1/admin/users/:id` (`active`) y `POST /v1/admin/users/:id/password`.
- Login por REST (`accounts:signInWithPassword`) y con Firebase JS 13.0.0 (`signInWithEmailAndPassword`).
- Al final cada cuenta se borra con su propio token; una consulta con la cuenta de servicio confirmó 0 cuentas en el proyecto.

## Resultados

| Dominio | Alta | Login REST | Login Firebase JS | `/v1/me` | Desactivado | Contraseña nueva |
|---|---|---|---|---|---|---|
| `maunedas.local` | ✓ (0.9 s) | ✓ | ✓ | ✓ | `USER_DISABLED` (REST), `auth/user-disabled` (JS), 403 en el Worker | la vieja falla, la nueva entra |
| `maunedas.test` | ✓ | ✓ | (1) | ✓ | `USER_DISABLED`, 403 | ✓ |
| `maunedas.invalid` | ✓ | ✓ | (1) | ✓ | `USER_DISABLED`, 403 | ✓ |
| `users.maunedas.workers.dev` | ✓ | ✓ | (1) | ✓ | `USER_DISABLED`, 403 | ✓ |

(1) En la primera pasada el SDK en Node no mandaba `Referer` y la API key web, restringida al host de dev, respondió `auth/requests-from-referer-<empty>-are-blocked`: el SDK sí envió la petición con ese correo (no lo valida en el cliente) y la restricción funciona. Con el `Referer` del host permitido, como lo manda un navegador, el login JS de `maunedas.local` pasó completo; no hizo falta repetir los otros.

## Lectura

- Firebase acepta los cuatro dominios, incluidos TLD reservados (`.local`, `.test`, `.invalid`); se queda el primero, `maunedas.local`, que ya es el valor por omisión (`SYNTHETIC_EMAIL_DOMAIN`, 02 §3).
- Desactivar en el Worker bloquea las dos puertas: Firebase niega tokens nuevos y el Worker rechaza los vigentes (`USER_DISABLED`).
- Pendiente: confirmar el login en Android con el SDK de Firebase al hacer T-110.
