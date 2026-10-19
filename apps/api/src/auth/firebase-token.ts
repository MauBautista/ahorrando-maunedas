import { createRemoteJWKSet, errors, jwtVerify, type JWTPayload, type JWTVerifyGetKey } from 'jose';
import { ApiError } from '../errors';

/** Claims of a Firebase ID token used by the API (02 §5.1). */
export type FirebaseClaims = JWTPayload & {
  sub: string;
  email?: string;
  email_verified?: boolean;
  firebase?: { sign_in_provider?: string };
};

const GOOGLE_JWKS_URL = new URL(
  'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com',
);

let remote: JWTVerifyGetKey | undefined;

/**
 * Google's signing keys for Firebase ID tokens. `createRemoteJWKSet` caches them in the isolate, so
 * fetching them is network wait, not CPU.
 */
export const googleSigningKeys: JWTVerifyGetKey = (header, token) => {
  remote ??= createRemoteJWKSet(GOOGLE_JWKS_URL);
  return remote(header, token);
};

/**
 * Verifies signature, `iss`, `aud`, `exp`/`iat` and a non-empty `sub`. Token problems → 401 INVALID_TOKEN;
 * failing to fetch Google's keys is not the client's fault → 502 UPSTREAM_ERROR (so clients do not
 * discard a good token).
 */
export async function verifyFirebaseToken(
  token: string,
  projectId: string,
  keys: JWTVerifyGetKey = googleSigningKeys,
): Promise<FirebaseClaims> {
  let payload: JWTPayload;
  try {
    ({ payload } = await jwtVerify(token, keys, {
      issuer: `https://securetoken.google.com/${projectId}`,
      audience: projectId,
      algorithms: ['RS256'],
      clockTolerance: 5,
    }));
  } catch (err) {
    if (err instanceof errors.JWKSTimeout || !(err instanceof errors.JOSEError)) {
      throw new ApiError(502, 'UPSTREAM_ERROR', { service: 'google_jwks' });
    }
    throw new ApiError(401, 'INVALID_TOKEN');
  }
  if (typeof payload.sub !== 'string' || payload.sub === '') throw new ApiError(401, 'INVALID_TOKEN');
  return payload as FirebaseClaims;
}
