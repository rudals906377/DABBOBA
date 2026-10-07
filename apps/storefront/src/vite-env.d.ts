/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Cloudflare Pages build variable; only the exact value "LIVE" switches the storefront copy. */
  readonly VITE_DABBOBA_COMMERCE_MODE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
