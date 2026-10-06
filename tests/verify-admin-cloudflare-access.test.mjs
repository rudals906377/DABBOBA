import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  ADMIN_CONSOLE_LOGIN_URL,
  ADMIN_WRANGLER_CONFIG,
  readAdminAccessSettings,
  verifyAdminCloudflareAccess,
} from '../scripts/verify-admin-cloudflare-access.mjs';

const TEAM = 'dabboba.cloudflareaccess.com';
const AUD = '4714c1358e65fe4b408ad6d432a5f878f08194bdb4752441fd56faefa9b2b6f2';

function wrangler(overrides = {}, vars = {}) {
  const base = JSON.parse(readFileSync(ADMIN_WRANGLER_CONFIG, 'utf8'));
  return JSON.stringify({
    ...base,
    ...overrides,
    vars: { ...base.vars, ADMIN_CLOUDFLARE_ACCESS_TEAM_DOMAIN: TEAM, ADMIN_CLOUDFLARE_ACCESS_AUD: AUD, ...vars },
  });
}

function answer(status, location) {
  return async (url, init) => {
    assert.equal(url, ADMIN_CONSOLE_LOGIN_URL);
    assert.equal(init.redirect, 'manual');
    return new Response(null, { status, headers: location ? { location } : {} });
  };
}

const accessLogin = `https://${TEAM}/cdn-cgi/access/login/admin.dabboba.net?kid=${AUD}&redirect_url=%2Flogin`;

test('the committed console config keeps the Worker off workers.dev and preview hostnames', () => {
  const committed = JSON.parse(readFileSync(ADMIN_WRANGLER_CONFIG, 'utf8'));
  assert.equal(committed.workers_dev, false);
  assert.equal(committed.preview_urls, false);
  // Access is set up by the operator; until then the LIVE check refuses.
  assert.throws(() => readAdminAccessSettings(readFileSync(ADMIN_WRANGLER_CONFIG, 'utf8')), /ADMIN_CLOUDFLARE_ACCESS_TEAM_DOMAIN/);
});

test('Access settings must be complete and the bypass hostnames off', () => {
  assert.deepEqual(readAdminAccessSettings(wrangler()), { teamDomain: TEAM, audience: AUD });
  assert.throws(() => readAdminAccessSettings(wrangler({ workers_dev: true })), /workers_dev/);
  assert.throws(() => readAdminAccessSettings(wrangler({ preview_urls: undefined })), /preview_urls/);
  assert.throws(() => readAdminAccessSettings(wrangler({}, { ADMIN_CLOUDFLARE_ACCESS_AUD: '' })), /AUD/);
  assert.throws(() => readAdminAccessSettings(wrangler({}, { ADMIN_CLOUDFLARE_ACCESS_TEAM_DOMAIN: 'admin.dabboba.net' })), /TEAM_DOMAIN/);
});

test('the live console must redirect an unauthenticated visitor to the configured Access login', async () => {
  assert.deepEqual(
    await verifyAdminCloudflareAccess({ readWrangler: () => wrangler(), fetchImpl: answer(302, accessLogin) }),
    { teamDomain: TEAM, url: ADMIN_CONSOLE_LOGIN_URL },
  );
  const failures = [
    [answer(200), /answered 200/],
    [answer(403), /answered 403/],
    [answer(302), /answered 302/],
    [answer(302, 'https://admin.dabboba.net/'), /not admin\.dabboba\.net/],
    [answer(302, `https://other.cloudflareaccess.com/cdn-cgi/access/login/admin.dabboba.net?kid=${AUD}`), /not other\.cloudflareaccess\.com/],
    [answer(302, `https://${TEAM}/somewhere-else`), /Access login/],
    [answer(302, `http://${TEAM}/cdn-cgi/access/login/admin.dabboba.net`), /Access login/],
    [answer(302, `https://${TEAM}/cdn-cgi/access/login/admin.dabboba.net?kid=${'0'.repeat(64)}`), /audience differs/],
    [async () => { throw new Error('offline'); }, /Could not reach/],
  ];
  for (const [fetchImpl, message] of failures) {
    await assert.rejects(verifyAdminCloudflareAccess({ readWrangler: () => wrangler(), fetchImpl }), message);
  }
  // Without Access settings in the Worker config nothing is fetched.
  let fetched = false;
  await assert.rejects(
    verifyAdminCloudflareAccess({ readWrangler: () => wrangler({}, { ADMIN_CLOUDFLARE_ACCESS_AUD: '' }), fetchImpl: async () => { fetched = true; } }),
    /ADMIN_CLOUDFLARE_ACCESS_AUD/,
  );
  assert.equal(fetched, false);
});
