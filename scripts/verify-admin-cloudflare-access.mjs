#!/usr/bin/env node

// Confirms that the administrator console is behind Cloudflare Access, the
// owner-approved second factor for admin.dabboba.net (2026-10-06). The LIVE
// cutover runs this before any payment setting changes. Two layers must hold:
// the Worker verifies the Access token itself (team domain and audience tag in
// apps/admin/wrangler.jsonc, no workers.dev or preview hostname), and the live
// hostname sends an unauthenticated visitor to the Access login of that team.
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const ADMIN_WRANGLER_CONFIG = join(root, 'apps/admin/wrangler.jsonc');
export const ADMIN_CONSOLE_LOGIN_URL = 'https://admin.dabboba.net/login';

const TEAM_DOMAIN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.cloudflareaccess\.com$/;
const AUDIENCE = /^[0-9a-f]{64}$/;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

/** Reads and checks the Access settings the deployed console verifies tokens with. */
export function readAdminAccessSettings(wranglerText) {
  const config = JSON.parse(wranglerText);
  if (config.workers_dev !== false || config.preview_urls !== false) {
    throw new Error('apps/admin/wrangler.jsonc must set "workers_dev": false and "preview_urls": false so Access cannot be bypassed.');
  }
  const vars = config.vars ?? {};
  const teamDomain = String(vars.ADMIN_CLOUDFLARE_ACCESS_TEAM_DOMAIN ?? '').trim().toLowerCase();
  const audience = String(vars.ADMIN_CLOUDFLARE_ACCESS_AUD ?? '').trim().toLowerCase();
  if (!TEAM_DOMAIN.test(teamDomain) || !AUDIENCE.test(audience)) {
    throw new Error('Set ADMIN_CLOUDFLARE_ACCESS_TEAM_DOMAIN (<team>.cloudflareaccess.com) and ADMIN_CLOUDFLARE_ACCESS_AUD (the Access application audience tag) in apps/admin/wrangler.jsonc, then redeploy the console.');
  }
  return { teamDomain, audience };
}

/**
 * Throws unless an unauthenticated request to the console is redirected to the
 * configured Access team login. A console page, a 403 from the Worker alone or
 * a redirect to any other host all fail: they mean Access is missing at the
 * edge or belongs to a different application than the Worker verifies.
 */
export async function verifyAdminCloudflareAccess({
  readWrangler = () => readFileSync(ADMIN_WRANGLER_CONFIG, 'utf8'),
  fetchImpl = fetch,
  url = ADMIN_CONSOLE_LOGIN_URL,
} = {}) {
  const { teamDomain, audience } = readAdminAccessSettings(readWrangler());
  let response;
  try {
    response = await fetchImpl(url, { redirect: 'manual', headers: { accept: 'text/html' }, signal: AbortSignal.timeout(10_000) });
  } catch {
    throw new Error(`Could not reach ${url} to confirm Cloudflare Access.`);
  }
  const location = response.headers.get('location');
  if (!REDIRECT_STATUSES.has(response.status) || !location) {
    throw new Error(`${url} answered ${response.status} without the Cloudflare Access login redirect; protect admin.dabboba.net with an Access application first.`);
  }
  let target;
  try {
    target = new URL(location, url);
  } catch {
    throw new Error(`${url} redirected to an unreadable location.`);
  }
  if (target.protocol !== 'https:' || target.hostname !== teamDomain || !target.pathname.startsWith('/cdn-cgi/access/login/')) {
    throw new Error(`${url} must redirect to the Access login of ${teamDomain}, not ${target.hostname}.`);
  }
  const kid = target.searchParams.get('kid');
  if (kid && kid.toLowerCase() !== audience) {
    throw new Error('The live Access application audience differs from ADMIN_CLOUDFLARE_ACCESS_AUD in apps/admin/wrangler.jsonc.');
  }
  return { teamDomain, url };
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  verifyAdminCloudflareAccess()
    .then(({ teamDomain }) => process.stdout.write(`Admin console is behind Cloudflare Access (${teamDomain}).\n`))
    .catch((error) => {
      process.stderr.write(`${error instanceof Error ? error.message : 'Admin Access check failed.'}\n`);
      process.exitCode = 1;
    });
}
