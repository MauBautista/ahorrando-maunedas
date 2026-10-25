/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_FIREBASE_API_KEY: string;
  readonly VITE_FIREBASE_PROJECT_ID: string;
  readonly VITE_FIREBASE_APP_ID: string;
  readonly VITE_SYNTHETIC_EMAIL_DOMAIN: string;
}

/** The web app's version (package.json), sent as `X-Client-Version` (03 §1). */
declare const __APP_VERSION__: string;
