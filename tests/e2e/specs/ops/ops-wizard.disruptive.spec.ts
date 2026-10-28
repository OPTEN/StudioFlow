import crypto from 'node:crypto';
import tls from 'node:tls';
import { AdminApi } from '../../support/api';
import { TEST_DOMAIN, TEST_FRAME_ANCESTORS, stackConfig } from '../../support/env';
import { send } from '../../support/http';
import { selfSigned } from '../../support/selfsigned';
import { waitUntil } from '../../support/shell';
import { apiReady, compose, containerName, docker, ensureHealthy, serviceLogs, setupRequired, tryFetch, waitForSetupCode, writeStackSecrets } from '../../support/stack';
import { t } from '../../support/tags';
import { uniqueIp } from '../../support/fixtures';
import { expect, test } from '../../support/ui/fixtures';
import { RegiePage } from '../../support/ui/regie';

/**
 * OPS and the first-run wizard on a stack that starts from nothing (issue #27; docs/testing.md E2E-OPS-04, -38 to -41 and
 * E2E-WIZ-01, -02): `docker compose down --volumes` and `up` without any variable, the secrets the init service makes,
 * the setup code and its lockout, the wizard in the browser (account, media address with the WebRTC round trip, address
 * and certificate, embedding), the validation of every input of the settings, the secrets that no answer ever returns,
 * an uploaded certificate on the TLS port and a changed media address that LiveKit announces. The spec ends with the
 * harness state (the account and the settings of global setup), made by the wizard itself.
 */

test.describe.configure({ mode: 'serial' });
test.use({ locale: 'en-US' });

const CODE_PATTERN = /^[A-Z0-9]{4}-[A-Z0-9]{4}$/;

let initLog = '';

test.afterAll(async ({ adminSession, config }) => {
  test.setTimeout(420_000);
  // A failed test may have left the stack half set up: the harness state is the account and the settings of global setup.
  await ensureHealthy();
  await adminSession.login(config.admin.username, config.admin.password);
});

/** The names of the TLS certificate Caddy presents for a server name, with its SHA-256 fingerprint. */
function presented(servername: string): Promise<{ fingerprint: string; subject: string }> {
  const config = stackConfig();
  return new Promise((resolve, reject) => {
    const socket = tls.connect({ host: '127.0.0.1', port: config.httpsPort, servername, rejectUnauthorized: false }, () => {
      const certificate = socket.getPeerCertificate();
      socket.end();
      resolve({ fingerprint: certificate.fingerprint256, subject: JSON.stringify(certificate.subject) });
    });
    socket.setTimeout(8000, () => {
      socket.destroy();
      reject(new Error('TLS handshake timed out'));
    });
    socket.on('error', reject);
  });
}

test.describe('OPS fresh machine', () => {
  test('E2E-OPS-04 [stack] `docker compose up` on nothing: the init service makes three secrets, the stack is healthy without any variable, the Regie is served and the first-run setup is open', t.disruptive('@p0'), async ({ config }) => {
    test.setTimeout(600_000);
    await compose(['down', '--volumes', '--timeout', '30'], { check: true, timeoutMs: 300_000 });
    const started = Date.now();
    await compose(['up', '-d', '--wait', '--wait-timeout', '300'], { check: true, timeoutMs: 420_000 });
    await waitUntil('/health/ready 200', apiReady, { timeoutMs: 120_000, intervalMs: 500 });
    // New volumes, new secrets: the tests that follow read the key pair and the database password from this file.
    await writeStackSecrets();
    test.info().annotations.push({ type: 'measurement', description: `fresh start: healthy after ${Date.now() - started} ms` });

    initLog = (await compose(['logs', '--no-color', 'init'])).output;
    for (const secret of ['postgres-password', 'livekit-api-key', 'livekit-api-secret']) expect(initLog, `${secret} is made`).toContain(`secrets: ${secret} created`);
    expect(initLog).toContain('secrets: ready');
    const files = (await docker(['exec', containerName('api'), 'sh', '-c', 'stat -c "%n %a %u" /secrets/*'], { check: true })).stdout.trim().split('\n').sort();
    expect(files).toEqual(['/secrets/livekit-api-key 600 1654', '/secrets/livekit-api-secret 600 1654', '/secrets/postgres-password 600 1654']);
    for (const service of ['api', 'postgres', 'livekit', 'caddy', 'backup']) {
      const logs = (await docker(['logs', containerName(service)])).output;
      expect(logs, `${service}: no secret in the log`).not.toMatch(/AGE-SECRET-KEY|sk[A-Za-z0-9]{40,}/);
    }

    // Nothing is configured, the Regie is served on any name the browser uses (internal certificate on demand).
    expect(await setupRequired(), 'the first-run setup is open').toBe(true);
    expect(await waitForSetupCode()).toMatch(CODE_PATTERN);
    // Caddy starts with a page that says "starting"; the API pushes the real configuration within seconds.
    const served = Date.now();
    for (const host of ['localhost', '127.0.0.1']) {
      const url = `https://${host}:${config.httpsPort}/`;
      await waitUntil(`the Regie is served on ${host}`, async () => (await tryFetch(url, { timeoutMs: 4000 }))?.status === 200, { timeoutMs: 60_000, intervalMs: 500 });
      expect(await (await tryFetch(url))?.text(), `the page of the Regie on ${host}`).toContain('<sf-root');
    }
    test.info().annotations.push({ type: 'measurement', description: `the Regie was served ${Date.now() - served} ms after the stack was healthy` });
    const settings = await tryFetch(`${config.baseURL}/api/settings`);
    expect(settings?.status, 'the settings need a signed-in admin').toBe(401);
    const setup = await tryFetch(`${config.baseURL}/api/auth/setup`);
    expect(await setup?.json()).toEqual({ setupRequired: true });
    // The CA certificate is downloadable before anybody has signed in (a device must trust it before it can open the Regie).
    const ca = await tryFetch(`${config.baseURL}/ca.crt`);
    expect(ca?.status).toBe(200);
    expect(await ca?.text()).toContain('BEGIN CERTIFICATE');
  });

  test('E2E-OPS-38 [stack] the setup code is required and locks out after repeated failures; the settings and the wizard routes need the session', t.disruptive('@p0'), async ({ config }) => {
    test.setTimeout(240_000);
    const ip = uniqueIp();
    const attempt = (code: string) => send({ method: 'POST', url: `${config.apiDirect}/api/auth/setup`, headers: { 'X-Forwarded-For': ip }, json: { setupCode: code, username: 'intruder', password: 'An-Intruder-Passw0rd-1' } });
    // Five wrong codes from one address lock it out: the first four are refused as wrong, the fifth already answers 429.
    for (let index = 0; index < 4; index++) {
      const refused = await attempt('AAAA-AAAA');
      expect(refused.status, `attempt ${index + 1}`).toBe(403);
      expect(refused.json().code).toBe('setup_code_invalid');
    }
    expect([403, 429], 'the fifth wrong code').toContain((await attempt('AAAA-AAAA')).status);
    const locked = await attempt(await waitForSetupCode());
    expect(locked.status, 'even the right code is refused while locked out').toBe(429);
    expect(Number(locked.headers['retry-after'] ?? 0), 'retry-after').toBeGreaterThan(0);
    expect(await setupRequired(), 'no account was created').toBe(true);
    // Another address is not locked out.
    expect((await send({ method: 'POST', url: `${config.apiDirect}/api/auth/setup`, headers: { 'X-Forwarded-For': uniqueIp() }, json: { setupCode: 'BBBB-BBBB', username: 'intruder', password: 'An-Intruder-Passw0rd-1' } })).status).toBe(403);

    for (const [method, route] of [['GET', '/api/settings'], ['GET', '/api/settings/status'], ['PUT', '/api/settings/media'], ['PUT', '/api/settings/address'], ['PUT', '/api/settings/certificate'], ['PUT', '/api/settings/embedding'], ['PUT', '/api/settings/backup'], ['POST', '/api/settings/media/test'], ['POST', '/api/settings/backups']] as const) {
      const answer = await send({ method, url: `${config.baseURL}${route}`, headers: { 'X-StudioFlow': '1' }, json: method === 'GET' ? undefined : {} });
      expect(answer.status, `${method} ${route} without a session`).toBe(401);
    }
    // The internal routes of the API are not proxied: the public site answers with the page of the Regie, not with the API.
    const ask = await send({ method: 'GET', url: `${config.baseURL}/internal/tls/ask?domain=localhost` });
    expect(ask.headers['content-type'] ?? '', 'the internal routes are not part of the public site').toContain('text/html');
    expect(ask.text()).toContain('<sf-root');
    expect((await send({ method: 'GET', url: `${config.apiDirect}/internal/tls/ask?domain=localhost` })).status, 'the API answers Caddy on the compose network').toBe(200);
  });
});

test.describe('WIZ the wizard in the browser', () => {
  test('E2E-WIZ-01 [regie ui] account, media address with a WebRTC round trip, address and certificate, embedding: four steps, each saved, then the Regie opens', t.disruptive('@p0'), async ({ page, config }) => {
    test.setTimeout(420_000);
    await page.goto('/');
    await expect(page).toHaveURL(/\/setup$/);
    await expect(page.getByText('Step 1 of 4 · Account')).toBeVisible();

    // Step 1: the account (the setup code is in the log of the API).
    await page.getByLabel('Setup code').fill(await waitForSetupCode());
    await page.getByLabel('Username', { exact: true }).fill(config.admin.username);
    await page.getByLabel('Password', { exact: true }).fill(config.admin.password);
    await page.getByLabel('Repeat password').fill(config.admin.password);
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(page).toHaveURL(/\/setup\/server$/);

    // Until the media address is saved, every page of the Regie leads back to the wizard.
    await page.goto('/audit');
    await expect(page, 'the pages of the Regie lead to the wizard').toHaveURL(/\/setup\/server$/);
    await expect(page.getByRole('heading', { name: 'Set up the server' })).toBeVisible();
    await expect(page.getByText('Step 2 of 4 · Media address')).toBeVisible();

    // Step 2: the media address. An invalid one is refused in the form; a valid one is tested with a real round trip.
    const address = page.getByLabel('IPv4 address of this server');
    await address.fill('192.168.1');
    await page.getByRole('button', { name: 'Save and continue' }).click();
    await expect(page.getByText('Enter four numbers from 0 to 255 separated by dots')).toBeVisible();
    await address.fill(config.nodeIp);
    await page.getByRole('button', { name: 'Test connection' }).click();
    await expect(page.getByText(/The test worked: this browser exchanged data with the media server at .* \(round trip \d+ ms\)/), 'the WebRTC round trip through the address').toBeVisible({ timeout: 90_000 });
    await page.getByRole('button', { name: 'Save and continue' }).click();

    // Step 3: the address and the local certificate. The CA certificate can be downloaded; a domain is optional.
    await expect(page.getByText('Step 3 of 4 · Address and certificate')).toBeVisible({ timeout: 60_000 });
    const download = page.getByRole('link', { name: 'Download the CA certificate' });
    await expect(download).toHaveAttribute('href', '/ca.crt');
    await page.getByLabel('Domain', { exact: true }).fill('not a host');
    await page.getByRole('button', { name: 'Save and continue' }).click();
    await expect(page.getByText(/Enter a host name such as studioflow\.example\.com/)).toBeVisible();
    await page.getByLabel('Domain', { exact: true }).fill(TEST_DOMAIN);
    await page.getByRole('button', { name: 'Save and continue' }).click();

    // Step 4: the embedding.
    await expect(page.getByText('Step 4 of 4 · Embedding')).toBeVisible({ timeout: 60_000 });
    const origins = page.getByLabel('Allowed origins, one per line');
    await origins.fill(`${TEST_FRAME_ANCESTORS[0]}\nnot-an-origin`);
    await page.getByRole('button', { name: 'Save and finish' }).click();
    await expect(page.getByText(/Line 2 is not an origin/)).toBeVisible();
    await origins.fill(TEST_FRAME_ANCESTORS.join('\n'));
    await page.getByRole('button', { name: 'Save and finish' }).click();

    await expect(page.getByRole('heading', { name: 'The server is ready' })).toBeVisible({ timeout: 60_000 });
    await page.getByRole('button', { name: 'Open the control room' }).click();
    await new RegiePage(page, config).waitReady();

    // What the wizard saved is what global setup would have entered.
    const admin = await AdminApi.login(config.baseURL, config.admin);
    const settings = (await admin.getServerSettings()).body;
    expect(settings.configured).toBe(true);
    expect(settings.media.address).toBe(config.nodeIp);
    expect(settings.address).toMatchObject({ tlsMode: 'internal', domain: TEST_DOMAIN });
    expect(settings.embedding.origins).toEqual([...TEST_FRAME_ANCESTORS]);
    expect(settings.baseUrl).toBe(config.baseURL);
    // The wizard is gone for good; the setup page leads to the login.
    await page.goto('/setup/server');
    await expect(page).toHaveURL(/\/$/);
    expect((await admin.getServerSettingsStatus()).body).toMatchObject({ caddy: { applied: true }, liveKit: { applied: true } });
  });

  test('E2E-WIZ-02 [regie ui] the Server settings page: the services, the sections, the provider fields, the warning for paired devices, an own certificate and "Back up now"', t.disruptive('@p0'), async ({ page, config }) => {
    test.setTimeout(420_000);
    const regie = new RegiePage(page, config);
    await regie.loginViaApi();
    await page.goto('/');
    await regie.waitReady();
    await page.getByRole('button', { name: /^Production .*, menu$/ }).click();
    await page.getByRole('link', { name: 'Server settings' }).click();
    await expect(page).toHaveURL(/\/settings$/);
    await expect(page.getByRole('heading', { name: 'Server settings', level: 1 })).toBeVisible();

    // Services: all three run the saved settings.
    for (const service of ['Web server', 'Media server', 'Backup service']) {
      await expect(page.locator('.c-set__service', { hasText: service })).toContainText('runs the saved settings', { timeout: 60_000 });
    }
    await expect(page.getByLabel('IPv4 address of this server')).toHaveValue(config.nodeIp);
    await expect(page.getByLabel('Domain', { exact: true })).toHaveValue(TEST_DOMAIN);

    // A provider shows its own credential fields and needs the domain with a dot; nothing is saved by looking.
    const mode = page.getByLabel('Certificate', { exact: true });
    await mode.selectOption('dns-route53');
    await expect(page.getByLabel('Access key ID')).toBeVisible();
    await expect(page.getByLabel('Secret access key')).toBeVisible();
    await expect(page.getByLabel('Region (for example eu-central-1)')).toBeVisible();
    await expect(page.getByText(/Paired phones, laptops and output links open the address they were paired with/), 'the warning for paired devices').toBeVisible();
    await page.locator('sf-address-section').getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('Enter the domain.').or(page.getByText('Enter this value.')).first()).toBeVisible();
    await mode.selectOption('internal');

    // An own certificate: upload, save, and Caddy presents it for its name; then back to the local certificate.
    const made = selfSigned({ names: ['studio.e2e.test'] });
    await mode.selectOption('custom');
    await page.getByLabel('Domain', { exact: true }).fill('studio.e2e.test');
    await page.getByLabel('Certificate file (PEM)').setInputFiles({ name: 'fullchain.pem', mimeType: 'text/plain', buffer: Buffer.from(made.certificate) });
    await page.getByLabel('Private key file (PEM)').setInputFiles({ name: 'privkey.pem', mimeType: 'text/plain', buffer: Buffer.from(made.encryptedPrivateKey) });
    await page.locator('sf-address-section').getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText(/protected by a password/), 'a key with a password is refused with the reason').toBeVisible({ timeout: 30_000 });
    await page.getByLabel('Private key file (PEM)').setInputFiles({ name: 'privkey.pem', mimeType: 'text/plain', buffer: Buffer.from(made.privateKey) });
    await page.locator('sf-address-section').getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('Saved.').first()).toBeVisible({ timeout: 90_000 });
    await expect.poll(async () => (await presented('studio.e2e.test')).fingerprint, { timeout: 60_000, message: 'Caddy presents the uploaded certificate' }).toBe(made.fingerprint);
    await expect(page.getByText(/Current certificate: CN=studio\.e2e\.test/)).toBeVisible();

    await page.getByLabel('Domain', { exact: true }).fill(TEST_DOMAIN);
    await mode.selectOption('internal');
    await page.locator('sf-address-section').getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('Saved.').first()).toBeVisible({ timeout: 90_000 });
    // "Saved." can still be the notice of the first save, and Caddy applies the change a moment after the API saved it.
    await expect.poll(async () => (await presented('studio.e2e.test')).fingerprint, { timeout: 60_000, message: 'the uploaded certificate is not presented any more' }).not.toBe(made.fingerprint);

    // Backups: "Back up now" makes a manual backup that shows in the list.
    const before = await page.locator('.c-srv__table tbody tr').count();
    await page.getByRole('button', { name: 'Back up now' }).click();
    await expect(page.locator('.c-srv__table tbody tr')).toHaveCount(before + 1, { timeout: 120_000 });
    await expect(page.locator('.c-srv__table tbody tr').first()).toContainText('manual');
  });
});

test.describe('OPS settings validation and secrets', () => {
  test('E2E-OPS-38 [api] every input of the settings is validated: the answer is 400 with the field and a code, nothing is saved', t.disruptive('@p0'), async ({ config }) => {
    test.setTimeout(240_000);
    const admin = await AdminApi.login(config.baseURL, config.admin);
    const before = (await admin.getServerSettings()).body;
    const refused = async (what: string, result: Promise<{ status: number; body: unknown }>, field: string, code: string) => {
      const answer = await result;
      expect(answer.status, `${what}: ${JSON.stringify(answer.body).slice(0, 200)}`).toBe(400);
      expect(JSON.stringify((answer.body as { errors?: unknown }).errors), `${what}: errors`).toContain(field);
      expect(JSON.stringify((answer.body as { errors?: unknown }).errors), `${what}: code`).toContain(code);
    };
    for (const address of ['', 'abc', '1.2.3', '256.0.0.1', '0.0.0.0', '224.0.0.1', '01.2.3.4', '1.2.3.4.5', '192.168.1.1/24']) {
      await refused(`media ${address}`, admin.updateMediaSettings({ address }), 'address', 'media_address_invalid');
    }
    await refused('mode', admin.updateAddressSettings({ tlsMode: 'acme', domain: 'x.example.com' }), 'tlsMode', 'tls_mode_unknown');
    await refused('http-01 is gone', admin.updateAddressSettings({ tlsMode: 'http', domain: 'x.example.com' }), 'tlsMode', 'tls_mode_unknown');
    await refused('public domain needs a name', admin.updateAddressSettings({ tlsMode: 'dns-cloudflare', domain: '', dnsCredentials: { token: 'x'.repeat(40) } }), 'domain', 'domain_required');
    await refused('domain', admin.updateAddressSettings({ tlsMode: 'internal', domain: 'not a host' }), 'domain', 'domain_invalid');
    await refused('ip as domain', admin.updateAddressSettings({ tlsMode: 'internal', domain: '192.168.1.5' }), 'domain', 'domain_invalid');
    await refused('credentials', admin.updateAddressSettings({ tlsMode: 'dns-cloudflare', domain: 'studio.example.com' }), 'dnsCredentials', 'credential_required');
    await refused('unknown credential', admin.updateAddressSettings({ tlsMode: 'dns-cloudflare', domain: 'studio.example.com', dnsCredentials: { token: 'x'.repeat(40), extra: 'y' } }), 'dnsCredentials.extra', 'credential_unknown');
    await refused('credential shape', admin.updateAddressSettings({ tlsMode: 'dns-cloudflare', domain: 'studio.example.com', dnsCredentials: { token: 'short' } }), 'dnsCredentials.token', 'credential_invalid');
    await refused('email', admin.updateAddressSettings({ tlsMode: 'dns-cloudflare', domain: 'studio.example.com', acmeEmail: 'nobody', dnsCredentials: { token: 'x'.repeat(40) } }), 'acmeEmail', 'email_invalid');
    await refused('custom without a certificate', admin.updateAddressSettings({ tlsMode: 'custom', domain: 'studio.example.com' }), 'tlsMode', 'certificate_required');
    await refused('origin', admin.updateEmbeddingSettings({ origins: ['https://ok.example.com', 'ftp://nope', 'https://host/path'] }), 'origins[1]', 'origin_invalid');
    await refused('too many origins', admin.updateEmbeddingSettings({ origins: Array.from({ length: 21 }, (_, index) => `https://h${index}.example.com`) }), 'origins', 'too_many_origins');
    const backup = (overrides: Record<string, unknown>) => admin.updateBackupSettings({ schedule: null, timezone: null, keepDaily: 7, keepWeekly: 4, rcloneRemote: null, rcloneConfig: null, ageRecipients: [], offsiteUnencrypted: false, ...overrides });
    await refused('schedule', backup({ schedule: '61 * * * *' }), 'schedule', 'schedule_invalid');
    await refused('schedule fields', backup({ schedule: '* * * *' }), 'schedule', 'schedule_invalid');
    await refused('timezone', backup({ timezone: 'Mars Base' }), 'timezone', 'timezone_invalid');
    await refused('keep daily', backup({ keepDaily: 0 }), 'keepDaily', 'keep_invalid');
    await refused('keep weekly', backup({ keepWeekly: 105 }), 'keepWeekly', 'keep_invalid');
    await refused('remote', backup({ rcloneRemote: 'no colon' }), 'rcloneRemote', 'remote_invalid');
    await refused('rclone config', backup({ rcloneRemote: 'offsite:x', rcloneConfig: 'not an rclone config', ageRecipients: [`age1${'q'.repeat(58)}`] }), 'rcloneConfig', 'rclone_config_invalid');
    await refused('remote not in config', backup({ rcloneRemote: 'offsite:x', rcloneConfig: '[other]\ntype = local\n', ageRecipients: [`age1${'q'.repeat(58)}`] }), 'rcloneRemote', 'remote_not_in_config');
    await refused('age key', backup({ ageRecipients: ['age1short'] }), 'ageRecipients[0]', 'age_recipient_invalid');
    await refused('off-site without age', backup({ rcloneRemote: 'offsite:x', rcloneConfig: '[offsite]\ntype = local\n' }), 'ageRecipients', 'age_recipient_required');
    expect((await admin.getServerSettings()).body, 'nothing was saved').toEqual(before);

    // The CSRF header: a change without it is refused.
    const noCsrf = await admin.call('PUT', '/api/settings/embedding', { json: { origins: [] }, noCsrf: true });
    expect(noCsrf.status, 'no X-StudioFlow header').toBe(403);
    expect((await admin.getServerSettings()).body.embedding.origins).toEqual([...TEST_FRAME_ANCESTORS]);
  });

  test('E2E-OPS-39 [api] DNS credentials and the rclone configuration are stored encrypted and no answer, log or table ever shows them', t.disruptive('@p0'), async ({ config }) => {
    test.setTimeout(300_000);
    const admin = await AdminApi.login(config.baseURL, config.admin);
    const token = `cf-${crypto.randomBytes(18).toString('hex')}`;
    const rclone = `[offsite]\ntype = s3\nsecret_access_key = ${crypto.randomBytes(12).toString('hex')}\n`;
    const secrets = [token, rclone.split('secret_access_key = ')[1]!.trim()];
    try {
      // The e-mail and the delegated challenge domain are plain settings; the token is a secret.
      const saved = await admin.updateAddressSettings({ tlsMode: 'dns-cloudflare', domain: 'studio.example.com', acmeEmail: 'ops@example.com', dnsChallengeDomain: '_acme-challenge.studio.dedyn.io', dnsCredentials: { token } });
      expect(saved.status, saved.raw.text()).toBe(200);
      expect(saved.body.address).toMatchObject({ tlsMode: 'dns-cloudflare', domain: 'studio.example.com', acmeEmail: 'ops@example.com', dnsChallengeDomain: '_acme-challenge.studio.dedyn.io', credentialFields: ['token'] });
      const backup = await admin.updateBackupSettings({ schedule: null, keepDaily: 7, keepWeekly: 4, rcloneRemote: 'offsite:folder', rcloneConfig: rclone, ageRecipients: [`age1${'q'.repeat(58)}`], offsiteUnencrypted: false });
      expect(backup.status, backup.raw.text()).toBe(200);
      expect(backup.body.backup).toMatchObject({ rcloneRemote: 'offsite:folder', rcloneConfigured: true });

      // No answer carries a secret: not the settings, not the status, not the list of backups.
      for (const route of ['/api/settings', '/api/settings/status', '/api/settings/backups', '/api/system/info']) {
        const answer = await admin.call('GET', route);
        for (const secret of secrets) expect(answer.raw.text(), `GET ${route}`).not.toContain(secret);
      }
      // The database holds ciphertext only.
      const stored = await docker(['exec', containerName('postgres'), 'psql', '-U', 'studioflow', '-d', 'studioflow', '-tAc', 'select dns_credentials_protected || rclone_config_protected from server_settings'], { check: true });
      for (const secret of secrets) expect(stored.stdout, 'server_settings').not.toContain(secret);
      expect(stored.stdout.trim().length, 'something is stored').toBeGreaterThan(40);
      // No log of the stack names a secret, and the files that Caddy and the backup service read hold the secret only
      // where it belongs: the rclone configuration in the settings volume of the backup service, the token in no file.
      for (const service of ['api', 'caddy', 'livekit', 'postgres', 'backup']) {
        const logs = await serviceLogs(service);
        for (const secret of secrets) expect(logs, `${service} log`).not.toContain(secret);
      }
      const caddyConfig = await docker(['exec', containerName('caddy'), 'curl', '-s', '--unix-socket', '/run/caddy-admin/admin.sock', 'http://caddy-admin/config/'], { check: true });
      expect(caddyConfig.stdout, 'the DNS token is part of the running Caddy configuration, which only Caddy and the API can read (unix socket)').toContain(token);
      const viaHttps = await fetch(`${config.baseURL}/config/`);
      expect(await viaHttps.text()).not.toContain(token);
      // The audit log names the change, not the values.
      const audit = await docker(['exec', containerName('postgres'), 'psql', '-U', 'studioflow', '-d', 'studioflow', '-tAc', "select string_agg(action || ' ' || coalesce(details::text, ''), '|') from audit_entries where action like 'settings.%'"], { check: true });
      expect(audit.stdout).toContain('settings.address.changed');
      for (const secret of secrets) expect(audit.stdout, 'audit details').not.toContain(secret);
    } finally {
      await admin.updateBackupSettings({ schedule: null, keepDaily: 7, keepWeekly: 4, rcloneRemote: null, rcloneConfig: null, ageRecipients: [], offsiteUnencrypted: false });
      await admin.updateAddressSettings({ tlsMode: 'internal', domain: TEST_DOMAIN });
    }
    await waitUntil('Caddy runs the local certificate again', async () => (await admin.getServerSettingsStatus()).body.caddy.applied, { timeoutMs: 60_000, intervalMs: 1000 });
    const after = await admin.getServerSettings();
    expect(after.body.address.credentialFields, 'the credentials of the old mode are gone with it').toEqual([]);
  });

  test('E2E-OPS-40 [api] an uploaded certificate is checked (key, password, name, validity) and served by Caddy for its name; switching back removes it', t.disruptive('@p0'), async ({ config }) => {
    test.setTimeout(300_000);
    const admin = await AdminApi.login(config.baseURL, config.admin);
    const good = selfSigned({ names: ['studio.e2e.test'] });
    const other = selfSigned({ names: ['studio.e2e.test'] });
    const refused = async (what: string, pem: string, key: string, domain: string | undefined, field: string, code: string) => {
      const answer = await admin.uploadCertificate({ certificatePem: pem, privateKeyPem: key, domain });
      expect(answer.status, what).toBe(400);
      expect(JSON.stringify((answer.body as { errors?: unknown }).errors), what).toContain(field);
      expect(JSON.stringify((answer.body as { errors?: unknown }).errors), what).toContain(code);
    };
    await refused('not a certificate', 'nonsense', good.privateKey, 'studio.e2e.test', 'certificatePem', 'certificate_invalid');
    await refused('not a key', good.certificate, 'nonsense', 'studio.e2e.test', 'privateKeyPem', 'private_key_invalid');
    await refused('key with a password', good.certificate, good.encryptedPrivateKey, 'studio.e2e.test', 'privateKeyPem', 'private_key_encrypted');
    await refused('key of another certificate', good.certificate, other.privateKey, 'studio.e2e.test', 'privateKeyPem', 'certificate_key_mismatch');
    await refused('other name', good.certificate, good.privateKey, 'elsewhere.e2e.test', 'certificatePem', 'certificate_name_mismatch');
    const expired = selfSigned({ names: ['studio.e2e.test'], validDays: -1, startedDaysAgo: 10 });
    await refused('expired', expired.certificate, expired.privateKey, 'studio.e2e.test', 'certificatePem', 'certificate_expired');
    const future = selfSigned({ names: ['studio.e2e.test'], startedDaysAgo: -5 });
    await refused('not valid yet', future.certificate, future.privateKey, 'studio.e2e.test', 'certificatePem', 'certificate_not_yet_valid');
    expect((await admin.updateAddressSettings({ tlsMode: 'custom', domain: 'studio.e2e.test' })).status, 'the mode custom needs a stored certificate').toBe(400);

    try {
      const stored = await admin.uploadCertificate({ certificatePem: good.certificate, privateKeyPem: good.privateKey, domain: 'studio.e2e.test' });
      expect(stored.status, stored.raw.text()).toBe(200);
      expect(stored.body.address.certificate).toMatchObject({ names: ['studio.e2e.test'], fingerprint: expect.any(String) });
      expect(JSON.stringify(stored.body), 'the key never comes back').not.toContain('PRIVATE KEY');
      const custom = await admin.updateAddressSettings({ tlsMode: 'custom', domain: 'studio.e2e.test' });
      expect(custom.status, custom.raw.text()).toBe(200);
      await waitUntil('Caddy runs the uploaded certificate', async () => (await admin.getServerSettingsStatus()).body.caddy.applied, { timeoutMs: 60_000, intervalMs: 1000 });
      await expect.poll(async () => (await presented('studio.e2e.test')).fingerprint, { timeout: 60_000, message: 'the TLS port presents the uploaded certificate' }).toBe(good.fingerprint);
    } finally {
      await admin.updateAddressSettings({ tlsMode: 'internal', domain: TEST_DOMAIN });
    }
    await waitUntil('Caddy runs the local certificate again', async () => (await admin.getServerSettingsStatus()).body.caddy.applied, { timeoutMs: 60_000, intervalMs: 1000 });
    expect((await presented('studio.e2e.test')).fingerprint, 'the uploaded certificate is not presented any more').not.toBe(good.fingerprint);
    expect((await admin.getServerSettings()).body.address.certificate, 'the stored certificate goes with the mode').toBeNull();
  });

  test('E2E-OPS-41 [api] changing the media address makes LiveKit announce the new IP; a test announces an address for two minutes and is refused while a broadcast is live', t.disruptive('@p0'), async ({ config }) => {
    test.setTimeout(420_000);
    const admin = await AdminApi.login(config.baseURL, config.admin);
    const livekitLog = async () => (await compose(['logs', '--no-color', '--tail', '200', 'livekit'])).output;
    const announced = async (ip: string) => (await livekitLog()).includes(`"nodeIP": "${ip}"`);
    const yaml = async () => (await docker(['exec', containerName('livekit'), 'cat', '/lk/livekit.yaml'], { check: true })).stdout;
    expect(await yaml()).toContain(`node_ip: ${config.nodeIp}`);
    expect(await yaml(), 'the key pair is the one of the secrets volume').toContain(config.livekit.apiKey);

    const changed = await admin.updateMediaSettings({ address: '10.99.99.99' });
    expect(changed.status, changed.raw.text()).toBe(200);
    expect(changed.body.baseUrl, 'a media address does not change the address devices open').toBe(config.baseURL);
    await waitUntil('LiveKit announces the new address', async () => (await announced('10.99.99.99')) && (await yaml()).includes('node_ip: 10.99.99.99'), { timeoutMs: 90_000, intervalMs: 1000 });
    expect((await admin.getServerSettingsStatus()).body.liveKit.applied).toBe(true);

    // A test announces an address without saving it; ending it returns to the saved one.
    const trial = await admin.startMediaTest({ address: config.nodeIp });
    expect(trial.status, trial.raw.text()).toBe(200);
    expect(trial.body.first.token).toBeTruthy();
    expect(trial.body.second.identity).not.toBe(trial.body.first.identity);
    expect(await yaml(), 'the trial announces the tested address').toContain(`node_ip: ${config.nodeIp}`);
    expect((await admin.endMediaTest()).status).toBe(204);
    await waitUntil('LiveKit is back at the saved address', async () => (await yaml()).includes('node_ip: 10.99.99.99'), { timeoutMs: 60_000, intervalMs: 1000 });

    // Invalid and refused cases.
    expect((await admin.startMediaTest({ address: 'nope' })).status).toBe(400);
    const production = (await admin.getActiveProduction()).body;
    expect((await admin.startBroadcast(production.id)).status).toBe(200);
    try {
      const refused = await admin.startMediaTest({ address: config.nodeIp });
      expect(refused.status, 'no restart of LiveKit during a broadcast').toBe(409);
      expect((refused.body as { code?: string }).code).toBe('broadcast_live');
      const save = await admin.updateMediaSettings({ address: config.nodeIp });
      expect(save.status).toBe(409);
      expect((await yaml()).includes('node_ip: 10.99.99.99'), 'nothing changed').toBe(true);
    } finally {
      await admin.resetBroadcast(production.id);
    }

    const restored = await admin.updateMediaSettings({ address: config.nodeIp });
    expect(restored.status, restored.raw.text()).toBe(200);
    await waitUntil('LiveKit announces the harness address again', async () => (await yaml()).includes(`node_ip: ${config.nodeIp}`), { timeoutMs: 90_000, intervalMs: 1000 });
    await ensureHealthy();
  });
});
