/**
 * Per-request administrator console CSP. Scripts are allowed only through the
 * request nonce (plus scripts those nonce-bearing scripts load), so injected
 * inline markup cannot execute. Styles keep 'unsafe-inline' because React
 * style attributes and Next.js style tags cannot all carry a nonce.
 */
export function adminContentSecurityPolicy(nonce: string, development: boolean): string {
  return [
    "default-src 'self'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "object-src 'none'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${development ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https:",
    "connect-src 'self'",
    "font-src 'self' data:",
  ].join("; ");
}

export function createCspNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
