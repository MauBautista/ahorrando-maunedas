// SDD 03 §2. Values per environment live in wrangler.jsonc (vars) and `wrangler secret` (secrets).
export interface Env {
  DB: D1Database;
  IMAGES: R2Bucket;
  ASSETS: Fetcher;
  // vars
  FIREBASE_PROJECT_ID: string;
  SYNTHETIC_EMAIL_DOMAIN: string;
  PUBLIC_BASE_URL: string; // https://maunedas.<subdominio>.workers.dev
  MIN_CLIENT_SCHEMA: string; // "1"
  OFF_USER_AGENT: string; // "AhorrandoMaunedas/1.0 (uso personal)"
  AI_RECEIPT_PROVIDER: string;
  AI_RECEIPT_MODEL: string;
  AI_RECEIPT_EST_COST_USD: string; // "0.01" for the budget pre-check
  AI_IMAGE_EDIT_PROVIDER: string;
  AI_IMAGE_EDIT_MODEL: string;
  AI_IMAGE_EDIT_EST_COST_USD: string; // E3
  AI_MONTHLY_BUDGET_USD: string; // "6"
  AI_SOFT_LIMIT_PCT: string; // "80"
  // secrets
  GOOGLE_SERVICE_ACCOUNT: string; // service account JSON
  OPENROUTER_API_KEY: string;
  AGENT_TOKEN_SHA256: string; // hex sha256 of the agent token
  IMAGE_URL_SECRET: string; // HMAC for signed URLs
  BOOTSTRAP_TOKEN?: string; // only until the first admin exists
}

/** Hono generics shared by every route and middleware. */
export interface AppEnv {
  Bindings: Env;
  Variables: { requestId: string };
}
