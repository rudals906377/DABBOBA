/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Public API origin. HTTPS is required outside localhost/private-LAN QA. */
  readonly VITE_DABBOBA_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
